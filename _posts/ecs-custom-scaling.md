---
title: "Customized Scaling of AWS ECS"
excerpt: "There are multiple use cases to containerize and host proprietary applications on AWS ECS which is “a fully managed container orchestration service that makes it easy for you to deploy, manage, and scale containerized applications”

Scaling ECS then is one of the key needs of any application. This article describes challenges with ECS supported scaling and describes a custom solution to alleviate them."
coverImage: "/assets/blog/ecs-custom-scaling/custom_autoscaling.png"
date: "2024-08-16T15:35:07.322Z"
author:
  name: Vibhor Agarwal
  picture: "/assets/blog/authors/techvibhor.png"
ogImage:
  url: "/assets/blog/ecs-custom-scaling/custom_autoscaling.png"

---



## Problem Statement

In this scenario, application hosted on AWS ECS can process a wide range of requests, each with unpredictable compute usage and uncertain execution time.

The core back-end architecture on AWS is based on asynchronous processing, where SQS receives the requests. The application on AWS ECS (Fargate) polls continuously on SQS for incoming requests and process them.

One of the use cases for us is that the users can split a single large request into multiple smaller requests and distribute them asynchronously to cloud, for parallel processing to reduce the overall processing time by even 10-12 times (from even hours to minutes). ECS needs to scale quickly & accurately to be able to serve the spikes in demand. 

The ECS task needs to run the application for an uncertain amount of time, could be seconds or days. The compute usage statistics are not dependable to find if a particular task is active. This means that the scale-in action can kill active tasks and jobs which is highly undesirable.
Implementing scaling with the below policies to meet above requirements is a challenge.

### Target Tracking Scaling Policies


Link below describe automatic scaling support from ECS.
https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html

The default automatic scaling policy support from ECS can increase or decrease the number of tasks that your service runs based on a target value for a specific metric. 

1.	The scale out action based on compute usage spikes, but there would be cases when compute usage is un-predictable, where few requests consume negligible compute but need to parallel processing with others
2.	Inability to configure the exact number of tasks needed with out-of-the-box basic scaling
3.	Default scale out takes minutes before application in the container picks requests for processing
4.	Default scale in takes 5-15 minutes causing wasted compute adding to unnecessary costs. More importantly, the scale-in policy cannot identify & stop the actual idle tasks, just based on compute usage, resulting in stopping active tasks !!
5.	For the scale-in event, KILL signal sent by ECS expects tasks to complete their job within 30 seconds, which was not possible, depending on the nature of the application.


### Step Scaling Policies

Limitations of basic target-tracking policies drove the need to set up customized step auto-scaling policies based on cloud watch metrics on request count on SQS (possible with both default from ECS or custom metrics.
These policies use Cloud Watch alarms and aggregates metric data points based on the statistic for the metric. On breach of the alarm, the appropriate scaling policy in invoked. 
Step scaling policies are complex and in-capable to decide exact desired count needed. Additionally, Cloud Watch alarms are costly & slow in response. 
The core issues with still slow scaling (out or in) stays un-resolved and the scaling policy cannot find the idle tasks to stop when scaling in, which is the key requirement. Even the advanced customized auto scaling policies can only "approximate" scaling needs.

The link below is an interesting read on how cluster auto scaling works, the complexity and math applied in implementing scaling policy.

https://aws.amazon.com/blogs/containers/deep-dive-on-amazon-ecs-cluster-auto-scaling/



## Custom Solution

### Summary

With multiple limitations in what ECS supports by default,  there is a need to build a  custom scaling solution by updating desired count on AWS ECS Fargate service. In the example above, desired count is known by querying SQS for the available message count.

### Extend solution with ECS Capacity Providers

An EC2 auto-scaling group can provide capacity to ECS instead of the serverless Fargate option; preferred in certain scenarios such as:

a.	ECS Fargate does not support exceptionally large compute (up-to 16 vCPUs now)
b.	The image caching feature of container is another valuable proposition when using ECS with EC2, especially when images are large. Currently, Fargate does not offer container image caching feature. This allows single EC2 to run multiple instances of the container but downloading the container image only once for that EC2.
c.	EC2 warm-up pool saves on instance provisioning times unlike Fargate instances
d.	Need for more control over infrastructure, for example, specific OS configuration.

Extend solution to support ECS with EC2, to simultaneously update auto-scaling group (ASG) configured as the "capacity provider" to ECS service. This is more complex to design & configure.

### Solution Components & Configuration

1.	AWS ECS runs application container on Fargate or uses auto-scaling group (ASG) as the "capacity provider"
2.	An event bridge bus with a set of rules intercepts the scaling event and triggers a lambda (target) which runs ECS scaling logic, referred now as ecs-scaling-lambda
3.	ecs-scaling-lambda's environment is prepared with required properties to talk to AWS such as queue name, ECS cluster & service details, min/max desired count. With ASG,  attributes such as per EC2 capacity, min/max ASG count.
4.	Configure ecs-scaling-lambda as ASG custom termination policy (for ECS with EC2). Per documentation Amazon EC2 Auto Scaling uses termination policies to prioritize which instances to terminate first when decreasing the size of your Auto Scaling group (referred to as scaling in). However, this works fine even to stop EC2 to return them to the warm pool.
5.	Design lambda to respond to scale up and scale down events. Additionally, configure lambda to respond to auto-scaling service scale-down event, with the list of EC2 to stop (needed when ASG is the "capacity provider")


### Solution Architecture

 
 ![Architecture]( "/assets/blog/ecs-custom-scaling/custom_autoscaling.png")  



## Implementation

### ECS Scaling Lambda Handler

The lambda handler function responds to these event types 

a.	Scale up for new requests
b.	Scale down when task shuts down 
c.	Respond to ASG scale-down event with the idle instance-ids to stop.

```python 
def lambda_handler(event, context):
    
    # Read event type, parse it based on your application
    # ASG when scaling in sends an event with cause SCALE_IN
    event_type = get_event_type(event)

    if event_type == "_scale_up":
        return scale_up()

    if event_type == "_scale_down":
        return scale_down()

    if event_type == "asg_scale_down":
        # Response to auto-scaling service with idle EC2
     # Reset idle_ec2 in environment to empty
        return  {"InstanceIDs": [env.idle_ec2]}

    return None

```


### Scale Up

On receiving a request, application emits a scale-up event. For example, application may receive a request via an API or via an async trigger such as, on a file upload.
	
```python
   # Application when receiving a request
   event_bridge.put_event(source,"_scale_up", event)
```

On receiving a scale-up event, ecs-scaling-lambda calculates & updates the new desired count on ECS based on its current running & pending task count; and based on pending requests on the queue.
The lambda caps the maximum desired count as configured is its environment (same as on the ECS service).
When using ASG, start EC2s on scale-up event by calculating and updating ASG's desired count, again based on ECS scaling status and per EC2 processing capability (e.g., a 32 vCPU EC2 can process four requests when one request uses maximum 8 vCPU). ASG "capacity provider" itself is configured with placement strategy "binpack" to maximize compute utilization & run with minimal instances.

```python
def scale_up():
    queued = Queue.get_available_messages_count()
    if queued <= 0:
        return None

    desired, running = ECS.get_task_count()

    pending = desired - running
    to_add = queued - pending

    if to_add <= 0:
        update_asg_desired(desired)
        return desired

    # Limit to count as configured
    tasks_desired = desired + to_add
    tasks_desired = min(tasks_desired, env.max_tasks)

    # Need update of ASG for EC2 deployments and new tasks
    update_asg_desired(tasks_desired)
    ECS.update_ecs_desired(tasks_desired)


def update_asg_desired(tasks_desired):
    
    if not env.is_asg_providing_capacity:
        return None
    
    # Query ASG to fetch in service instances, and its desired count
    in_service_instances, desired = AutoScaling.describe()
    
    # Calculate capacity of 1 EC2
    capacity = desired * env.ec2_capacity

    if capacity >= tasks_desired:
        return None
    
    # Calculate new ASG desired count
    new_desired = int(math.ceil((tasks_desired - capacity) / 
                                env.ec2_capacity)) + desired
    
    # But cap with maximum ASG size
    new_desired = min(new_desired, env.max_ec2)
    
    # Update ASG to start exact needed EC2
    AutoScaling.set_desired_count(new_desired, desired)

``` 

### Scale Down

*Container triggers scale down event*

The container application keeps on processing requests and checks if it has been idle for too long (for example, idle time of 30 seconds). Only the container in the task decides when it is idle & when idle, requests ECS for its shutdown, stops accepting any more requests and generates a scale-down event.
The task itself needs to query ECS to fetch running count and request shutdown but try to keep minimum desired count.

Stopping of "self' is the key to be able request ECS service for a graceful shutdown.

 ```python 
    # ----- Code Inside Container ----

    # Container starting. Define an Exit Handler
    exit_handler = ExitHandler()
    signal.signal(signal.SIGTERM, exit_handler.shutdown)

    while not exit_handler.stop:
        if shutdown_mode:
            # Do not pick any requests.
            # Though the SIGTERM is immediate
            time.sleep(0.5)
            continue
        # Main app processing logic
        if is_request_available():
            process()
        else:
            # Check since how long the process has been idle 
            shutdown_mode = stop_if_idle(last_active_at, timeout)
		


    def stop_if_idle(last_active_at, timeout):
        # If the task had been idle for too long, stop itself
        if (time.time() - last_active_at) <= timeout:

            # Check ECS for if running more than minimum tasks
            can_i_shut_down()

            # Query ECS metadata service to get own (task) ARN
            ecs.stop_task(
                    cluster=self.cluster,
                    task=self.task_arn,
                    reason="Custom scale in")
            # Scale down event for this task which wants to stop
            EventBridge.put_event(self.service_arn,
                                "_scale_down",
                                {'timestamp': str((time.time()))},
                                [self.task_arn])
            return True

```

AWS ECS service on the other hand, on receiving the STOP request sends a KILL SIGNAL to this task, which the container process reads and exits completely. The task finally shuts down gracefully.


*ecs-scaling-lambda responds to scale down event*

ecs-scaling-lambda intercepts scale-down event and decrements ECS desired task count. While ECS service performs the action of stopping the task by sending KILL signal, the decremented desired count ensures a replacement task is not spun. "Stopping the task" and "decrementing desired count" works together in conjunction.

```python 
def scale_down():
    ECS.decrement_desired_tasks()
    if env.is_asg_providing_capacity:
       scale_down_asg()
```



With shutdown of idle tasks one by one, finally ECS runs minimum desired count.

With ASG when used, to scale down ASG to the needed EC2 count, find idle EC2, and ask auto-scaling service to shut down only the idle instances, and decrement ASG's desired count simultaneously.
 
In the below code snippet, the update of desired count on ASG results in auto-scaling service invoking ecs-scaling-lambda again, asking for list of EC2s to stop. Configure a  custom termination policy on ASG to stop only the idle instances.
The lambda responds with the list of idle EC2 instance-ids (see lambda_handler definition) and auto-scaling service either stops them to return them to the warm pool or terminates them when there is no warm pool used.


```python
def scale_down_asg():

    # Query auto scaling service for in-service EC2, desired count
    in_service_instances, current_desired = AutoScaling.describe()
    
    # Query ECS to find EC2 that are in use by the tasks
    ecs_instances = ECS.get_instances_in_use()
    new_desired = len(ecs_instances) if ecs_instances else 0

    # Find idle EC2
    if not ecs_instances:
        idle = in_service_instances
    else:
        idle = in_service_instances - ecs_instances

    if not idle:
        return
    if not ecs_instances:
        # ECS is not using any EC2, ASG desired be 0
        new_asg_desired = 0
    else:
        new_asg_desired = len(ecs_instances)

    # Only decrement ASG desired count
    # This throws an event from AWS auto-scaling service that   
    # Lambda capture and returns actual instance IDS to 
    # Stop (with warm pool) or terminate
    AutoScaling.set_desired_count(new_asg_desired,            
                    current_desired)
    
    # Update Lambda environment with the set of idle EC2
    # Return them auto scaling service to stop these idle
    env.idle_ec2 = idle

```

## Design Considerations

1.	To accurately read the pending request count on SQS, use "FIFO" queue  and not "STANDARD" queue which "almost" guarantees accuracy (with slight delays seen up-to one second) in synchronizing the queue attributes. Scaling lambda waits & reads queue attributes after a second of the request made.
2.	Run scaling lambda with a reserved concurrency of one to avoid concurrent updates on the ECS service from multiple scaling events received at the same time. The ecs-scaling-lambda responds very quickly to the events, and a fixed concurrency of one adds negligible overhead.
3.	The capacity provider considered in design is 100% by either FARGATE or by EC2. Mixing "capacity provider" types would result in un-desired behavior.
4.	If using ASG as the "capacity provider" use the placement strategy binpack. This leaves  the least amount of unused CPU or memory. This strategy minimizes the number of container instances in use. Additionally, start with using no placement constraints. Turn off "instances protected from scale-in" on ASG, for the custom scaling to work.
5.	The capacity provider should still have "ecs managed scaling" turned on. Reason - If the scaling is "managed" by ECS, the ECS service waits for EC2s to come up and does not fail the tasks at once due to lack of available instances.
Also, turn off managed termination protection for the capacity provider.
Delete any lifecycle hooks on ASG that may intervene with the custom scaling service & add overhead.
6.	If using ASG, use ASG warm pool to save on time (turn on reuse on scale-in), to provision new instances.
7.	For improved performance, remember to re-use cached AWS connections in the lambda for improved performance & throughout your application



## More Ideas

1.	Before sending requests for processing, a trusted client can ask for capacity up front. Integrated with ecs-scaling-lambda, increment ECS desired count for the "expected" demand as asked by a smart client.
2.	With automated deployments, a new deployment would replace tasks & may shut down "active" processes, which is un-desired. Abort deployment if ECS is busy processing, by querying ECS desired/pending count to check if scaling is in progress & by querying cloud watch log activity from the container.
3.	To capture scaling metrics, persist ECS desired count update actions in a timestream database. One use case could be to see ECS scaling status and analyze in real-time how busy the system is.
4.	Asynchronous invocation of ecs-scaling-lambda means errors may go un-noticed. Configure destinations on ecs scaling lambda to be able to send out SNS email notifications on failed invocations.


## Solution Benefits

The solution is highly scalable, fast, re-usable, robust, and cost-effective for any AWS ECS deployment that needs to scale.

1.	Lambda itself is serverless pay-as-you-go service and runs with minimal compute (128 MB) to avoid costs & overhead of other components such as Cloud watch metrics & alarms or other resources
2.	Control exact desired count on ECS service. Custom calculation logic allows maximum control over updates on desired task count. For instance, can start say 10% or 4 more tasks to keep few instances warmed up.
3.	Event bridge is fast and within few hundred milliseconds of the scaling event, lambda can process it to update ECS, as compared against at least two minutes delay with out-of-the-box scaling solution. This means extremely fast response to scaling events. For the scale-up events, updates on desired count of ECS is immediate. With FARGATE, the tasks would start provisioning at once and with EC2 "capacity provider", the EC2 would start also provisioning at once. 
4.	The container can reliably run for as long as possible, even days, and can save considerable costs by shutting down with just few seconds of idle time (the logic within container as described). The solution gives complete control to the application on how long it wants to run, when it is idle.
5.	Simple solution that does not use any of the ECS target tracking, step scaling or other custom metrics-based policies.
