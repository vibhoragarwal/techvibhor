---
title: "Collecting custom API usage data for analytics asynchronously on AWS"
excerpt: "When you have custom API metrics to collect in a latency sensitive application, how do you design your architecture on AWS ?"
coverImage: "/assets/blog/api_analytics/analytics_title.png"
date: "2024-09-15T15:35:07.322Z"
author:
  name: Vibhor Agarwal
  picture: "/assets/blog/authors/techvibhor.png"
ogImage:
  url: "/assets/blog/aws-athena/analytics_title.png"

---



![](/assets/blog/api_analytics/analytics_title.png)  

# Introduction 

This blog describes the high level workflow to capture request data at various stages for analytics.
When working with APIs having complex multistage workflow, we may need to collect data a various stages of workflow to be able to analyze or improve
the business logic later.

To avoid adding latency, and to be able to still able to collect data at various stages, we would use asynchronous AWS services, and use AWS Timestream DB to
persist this data, and then export it on a daily basis to S3 in a partitioned format. We would then add a new API to allow download of this data.



## Objective

Collect API trace data in your lambda API workflow in custom format with fields that might be needed by developer for analysis in a S3 bucket, on a daily basis.
Data in S3 must be partitioned by year/month/day, so that we can even run Athena queries later.
Also, the data in S3 should be downloadable over an API call.

1. A framework utility (indicators below) can be used to collect data in a dictionary in your main lambda's memory (not described here).

2. Code may look like this to capture data in memory within each API call.

```python
def lambda_handler(event: any, context: any):
    # first thing in lambda handler
    analytics_data = MyInMemoryData.get_if_exists("AnalyticsData", None)
    if not analytics_data:
        MyInMemoryData.register("AnalyticsData", {})

    # re-initialize this.
    MyInMemoryData.AnalyticsData = {'time': str(int(time.time() * 1000)),
                                    'request_id': context.aws_request_id if context else "dummy"
                                    }
```

2. Capture key outcomes of API at various stages of workflow in a dictionary (lives in python memory)

```python
 # populate data for your in-memory dictionary at various stages of your code flow
 MyInMemoryData.AnalyticsData["json_request_body"] = copy.deepcopy(body)
 ...
 MyInMemoryData.AnalyticsData["col1"] = len(data)
 MyInMemoryData.AnalyticsData["col2"] = {some dict data}
 ....
 MyInMemoryData.AnalyticsData["response"] = {some dict data}
```

## Infrastructure as Code for this feature

Let us build the infrastructure first that can persist this data in a reliable & costeffective manner.
We would use AWS SQS, Lambda, Timestream, S3 primarily to build our solution.


Snippets below for 'serverless' framework with Cloud Formation.

[Serverless Infra as Code](https://www.serverless.com/framework/docs/providers/aws/guide/serverless.yml)

**'analytics' lambda which has 2 triggers:**

 - load on SQS
 - an event bridge event rule (CRON) that runs daily

The collected data, we would send to SQS, which would trigger this lambda which then processed the data and persist in AWS Timestream.
We then use another event to trigger the same lambda on a daily basis, to read the previous day's of collected data and persist in S3.

**'analytics-download' lambda offloads preparation of data for analytics on S3**

We would add a new API in our primary application which when receiving the request for data between start/end dates, it would use another queue to drop
the request and have this lambda process it to prepare the zip file from daily record files that we persisted earlier. A pre signed URL for this would
be sent to user to download the file once ready ( you can create a pre signed URL even when file does not exist yet :) )

 - load on a different queue, where message is sent when API request is received


 ```yaml
   analytics:
    handler: lambda_analytics.lambda_handler
    description: Lambda function to read request & response and log into timestream database, also to upload to s3 via CRON schedule
    memorySize: 128
    module: analytics
    events:
       - sqs: arn:aws:sqs:${self:provider.region}:${aws:accountId}:${self:provider.environment.SQS_ANALYTICS_NAME} # create entry in timestream
       - schedule: cron(0 0 * * ? *) # run daily, as the date changes, and same lambda then queries time stream and uploads data to S3
   analytics-download:
    handler: lambda_download_analytics.lambda_handler # on a SQS trigger (SQS sent when API all is received), zips and uploads to S3
    description: Lambda function to process download analytics data
    memorySize: 128
    module: analytics
    events:
      - sqs: arn:aws:sqs:${self:provider.region}:${aws:accountId}:${self:provider.environment.SQS_DOWNLOAD_ANALYTICS_NAME}
```



We need other cloud resources also:

1\. **AnalyticsSQS**: FIFO queue that would receive API data to persist in time stream database from 'analytics' lambda above

2\. **AnalyticsTimeStreamDB**: Time stream database

3\. **AnalyticsTimeStreamTable**: Table under the database; note that we do not write in magnetic store but only memory. 
In memory, only 1-hour old timestamp data can be written (we write instantly !). We also retain data in magnetic store (cheaper) for 7 days only

4\. **AnalyticsAsyncLambdaSNSDestination**, **AnalyticsAsyncLambdaSNSEmailSubscription1**: we also need a SNS topic and an email subscription to this topic to alert developers via email in case this functionality is broken ( since this feature is not exposed via API, users would not report failures)

5\. **AnalyticsS3Bucket**: S3 bucket to finally persist the time stream data. In STANDARD tier, we retain data for 2 months, to allow download of data in this period after which
   data is pushed to INFREQUENT ACCESS tier, where it stays for another 30 days, before being archived in GLACIER. The data expires after 1 year of its creation
   There is another lifecycle rule that we run for files under /tmp prefix in this bucket, to delete files after 1 day only ! This is to support admin requests to download data
   over a date range, which are zipped and uploaded under /tmp prefix as a zip file, for users to download via signed URL. Since this URL is active only for few minutes, we 
   do not need long retention for 'tmp' files, the contents of this prefix are cleaned up automatically in 1 day using S3 lifecycle rules.

6\. **AnalyticsDataDownloadSQS**: Queue to offload download data requests. Main lambda that received API requests can offload the work to this queue, which can be then processed by 'analytics-download' lambda.



```yaml
Resources:
    AnalyticsSQS:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: ${self:provider.environment.SQS_ANALYTICS_NAME}
        FifoQueue: true
        ReceiveMessageWaitTimeSeconds: 20 # long polling
        MessageRetentionPeriod: 600 # 10 mins
        VisibilityTimeout: 10 # for few seconds, not visible to other consumers once received by a consumer
    AnalyticsTimeStreamDB:
      Type: AWS::Timestream::Database
      Properties:
        DatabaseName: ${self:provider.environment.TIME_STREAM_DB_NAME}
    AnalyticsTimeStreamTable:
      Type: AWS::Timestream::Table
      Properties:
        DatabaseName: ${self:provider.environment.TIME_STREAM_DB_NAME}
        TableName: ${self:provider.environment.TIME_STREAM_TABLE_NAME}
        MagneticStoreWriteProperties:
          EnableMagneticStoreWrites: false
        RetentionProperties:
          MagneticStoreRetentionPeriodInDays: 7 # move to magnetic store after 1 hr
          MemoryStoreRetentionPeriodInHours: 1  # retain only minimal period here
    AnalyticsAsyncLambdaSNSDestination:
      Type: AWS::SNS::Topic
      Properties:
        DisplayName: 'Analytics Lambda Failure Notiffications'
        TopicName: SNS_TOPIC_NAME  # implement your email notif on failures
    AnalyticsAsyncLambdaSNSEmailSubscription1:
      Type: AWS::SNS::Subscription
      Properties:
        Endpoint: ${self:provider.environment.ADMIN_USERS}
        Protocol: "email"
        TopicArn: { "Ref": "AnalyticsAsyncLambdaSNSDestination" }
    AnalyticsS3Bucket:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: ${self:provider.environment.ANALYTICS_BUCKET}
        AccessControl: Private
        AccelerateConfiguration:
          AccelerationStatus: Enabled
        LifecycleConfiguration:
          Rules:
            - Id: TmpFilesDeleteRule # user requests keep tmp zip here, and serve them via pre-signed URLs, they are no longer needed when user downloads
              Prefix: tmp/
              Status: Enabled
              ExpirationInDays: 1 # run deletion midnight UTC following creation
            - Id: ToIAToGlacierRule # analytics requests collected need to remain in standard tier for several days for users to download historic usage stats
              Status: Enabled
              ExpirationInDays: 365
              Transitions:
                - TransitionInDays: 60  # allow fetch of upton 2 months of data in standard and then push to IA. Amazon S3 does not transition objects smaller than 128 KB to the Standard-IA
                  StorageClass: STANDARD_IA
                - TransitionInDays: 90  # remains in IA for 30 days, then pushed to archive
                  StorageClass: GLACIER
    AnalyticsDataDownloadSQS:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: ${self:provider.environment.SQS_DOWNLOAD_ANALYTICS_NAME}
        ReceiveMessageWaitTimeSeconds: 20 # long polling
        MessageRetentionPeriod: 300 # 5 mins
        VisibilityTimeout: 31 # for few seconds, not visible to other consumers once received by a consumer
```

Refer to the architecture for numbered flows.


![Analytics Architecture](/assets/blog/api_analytics/analytics.png)  


### FLOW 1: Analytics - collecting API trace in time stream DB

1\. Before sending the final primary API response to the user, the object's data is sent to a FIFO queue ( why FIFO ? to guarantee what is sent first is processed first, though not so critical)

2\. Load on queue would trigger the lambda function (see lambda_analytics.lambda_handler). For this SQS based trigger, create time stream record. 
Create a single  entry in AWS timestream database ( various attributes in dict would be various measures ) - this is a single multi measure record. In case of any errors, an email notification with exception trace can be sent to the admins.
Note that if lambda throws error, the record in SQS will be retained; you may want to handle the
exception and be notified, rather than keep un-processed records in queue.

[How to create multi measure record](https://aws.amazon.com/blogs/database/store-and-analyze-time-series-data-with-multi-measure-records-magnetic-storage-writes-and-scheduled-queries-in-amazon-timestream/)

Implement your own logic to create a single record with measure. Key points here:


   a. map right data type to the record, for e.g. you can use measure name to indicate type of data - str/numeric. 'json' can be converted to string and persisted in time stream.

```python
def prepare_measure(payload: dict, measure_name: str) -> dict:
  """prepare measure with attrs name, value and type
  Convert all JSON to VARCHAR and numeric type as BIGINT
  Args:
      payload: user data as dict
      measure_name: name of measure

  Returns:
      dict of measure
  """    print(result)_type = 'VARCHAR'
  elif "count" in measure_name:
      if measure_name not in payload:
          payload[measure_name] = -1 # indicates not relevant for when this measure has no collected data in api
      measure_value = str(payload[measure_name])
      measure_type = 'BIGINT'
  else:
      # measures such as request_id, user_id (varchar)
      # always expected in payload
      measure_value = str(payload[measure_name])
      measure_type = 'VARCHAR'

  return {
      'Name': measure_name,
      'Value': measure_value,
      'Type': measure_type
  }
```

   b. add measures in row itself for year, month and date, so that you can query it later.

```python
def prepare_partition_measures(timestamp: str) -> list:
  """prepare measure to use as partition

  Args:
      timestamp: timestamp as string for this time stream entry

  Returns:
      list of dicts, each as a time stream measure containing Name, Value & Type
  """
  year, month, day = split_date_time(timestamp) # implement split on your own
  return [{
      'Name': "year",
      'Value': year,
      'Type': 'VARCHAR'
  }, {
      'Name': "month",
      'Value': month,
      'Type': 'VARCHAR'
  }, {
      'Name': "day",
      'Value': day,
      'Type': 'VARCHAR'
  }]
```

 c. prepare common attributes

```python
def prepare_common_attributes(payload: dict) -> dict:
 """prepare common attributes for timestream such as dimensions, measure
 name and type as MULTI
 Args:
     payload: dict of user data

 Returns:
     dict
 """
 return {
     'Dimensions': [
         {'Name': 'api', 'Value': payload["request_url"]}
     ],
     'MeasureName': 'input_output',
     'MeasureValueType': 'MULTI'
 }
```

 d. capture exception when write fails


```python
try:
  # Write records to Timestream
  result = client.write_records(
      DatabaseName=db,
      TableName=table,
      CommonAttributes=prepare_common_attributes(payload),
      Records=records)
# pylint: disable=broad-except
except client.exceptions.RejectedRecordsException as err:
  print("RejectedRecords: ", err)
  msg = ""
  for key in err.response["RejectedRecords"]:
      msg += f"Rejected Index: {str(key['RecordIndex'])} : {key['Reason']}\n"
  raise Exception(msg) from err
```

3\. Data is retained in time stream database only for minimal period (1 day) after which it is sent to 'magnetic' store, and kept there for about a week ( magnetic store can be queried). Data is written only to memory store, not to magnetic store. 'EnableMagneticStoreWrites' is set to 'false'. We dont need to write there, as almost instantly, the data to write is available when a request to API comes in (API processing takes few seconds only) - data (identified by timestamp) is stale only by few seconds

From AWS: "The memory store is optimized for high throughput data writes and fast point-in-time queries.
The magnetic store is optimized for lower throughput late-arriving data writes, long term data storage, and fast analytical queries."


### FLOW 2: Analytics - uploading time stream data to S3

1\. The lambda : "lambda_analytics.lambda_handler" is also triggered on a daily basis at 00 hours GMT, by an event bridge rule (CRON job). Since this is an event, control code flow to invoke: 'load_timestream_data_to_s3' method ( we are using same lambda to create timestream entry and also to upload data to S3) - to keep logic together and for traceability.

```python
def load_timestream_data_to_s3() -> int:
    """query time stream DB
     Returns:
         count of rows processed
     """

    # Initialize the Timestream write client
    client = boto3.client('timestream-query')

    # Execute the query
    response = client.query(QueryString=get_query())

    # Extract the column names and rows
    columns = [column['Name'] for column in response['ColumnInfo']]

    rows = response['Rows']

    if not rows:
        print("nothing found in query to upload")
        return 0

    print(f"{len(rows)} found for upload..")

    buffer_map = {}

    def get_key():
        """get key to use
        Include prefix, and partition if any
        Returns:
            get the S3 bucket key to use
        """
        # day, month, year are at fixed positions at end
        day = row_data[len(row_data) - 1]
        month = row_data[len(row_data) - 2]
        year = row_data[len(row_data) - 3]
        # prepare the partition
        key = "my_analytics/year="
        key += year
        key += "/month="
        key += month
        key += "/day="
        key += day
        return key

    # assuming 128 MB would be sufficient to hold data in mem before dumping to s3
    def create_buffer_write():
        # Prepare the CSV data
        csv_buffer = io.StringIO()
        csv_writer = csv.writer(csv_buffer)
        # Write the header
        csv_writer.writerow(columns)
        return {"buffer": csv_buffer, "writer": csv_writer}

    # Write the rows
    for row in rows:
        row_data = [key.get('ScalarValue', 'NA') for key in row['Data']]
        obj_key = get_key()
        if obj_key not in buffer_map:
            buffer_map[obj_key] = create_buffer_write()
        buffer_map[obj_key]["writer"].writerow(row_data)

    do_upload(buffer_map)
    return len(rows)


def get_query() -> str:
    """create and return query to use

    Returns:
        string query
    """
    # query exactly entire yesterday's data

    # Define the database and table names
    db = os.environ.get('TIME_STREAM_DB_NAME')
    table = os.environ.get('TIME_STREAM_TABLE_NAME')

    # Define the Timestream query, 1 day ago's data
    ago_range = '1d'

    # these cols are expected based on how we inserted the data
    query_string = (
        "SELECT col1, col2, coln, year, month, day FROM \"{db}\".\"{table}\""
        f" WHERE time >= date_trunc('day', ago({ago_range}))"
        " AND time < date_trunc('day', now()) ORDER BY time ASC")

    return query_string


def do_upload(buffer_map: dict) -> None:
    """Upload data to s3

    Args:
        buffer_map: with key as object key and value as dict of buffer and writer objects

    Returns:
        nothing
    """
    s3 = boto3.client('s3')
    # Define the S3 bucket and object key
    bucket_name = "my-bucket"

    for obj_key in buffer_map:
        s3_key = os.path.join(obj_key, f'{str(uuid.uuid4())}.csv')
        # Upload the CSV data to S3
        buffer = None
        try:
            buffer = buffer_map[obj_key]["buffer"]
            print(f'  uploading to bucket {bucket_name} with key {s3_key}')
            s3.put_object(Bucket=bucket_name, Key=s3_key, Body=buffer.getvalue())
        finally:
             if buffer:
                buffer.close()
```

2\. Code forms a time stream DB query to query a day's ago of data, prepares the data buffer in memory, and uses the day/month/year fields in the record itself, to create a partition key, where the file with a unique name is finally uploaded

3\. In case of any errors, an email notification with exception trace can be sent to the administrators. Implement your logic.

4\. Now this partitioned data lake can be used to run analytical queries using Athena ( we can create table and load partitions when needed ) or can be downloaded when needed to analyze data via console or via APIs described below

5\. Note that the timestamp here can be used to trace the complete trace in Cloudwatch logs, as the timestamp is when the request reached the lambda function - this should be the first thing done in your lambda: instantiate the record that would go in for analytics with current timestamp


### FLOW 3: Analytics - download files for analytics

Build API to download analytica data such as: (/download/usage/start_date=yyyy-MM-dd&end_date=yyyy-MM-dd)


*Approach/ Implementation for this API*:

User provides date range, and this API would prepare the signed URL for "expected" (need not be already created !) object to be produced yet & send the request to another lambda for processing via SQS.

Message sending to SQS produces an ID called here 'sqs_identifier'


```python
 data = {'start_date': start_date, 'end_date': end_date}
 message_id = AnalyticsDataDownloadSQS.publish_queue_data(data) #implement your logic

 # use the file name : tmp/message_id.zip
 download_link = generate_presigned_download_url(message_id)

 # generate the pre signed URL even when download file is not ready, with a message
 # this avoids sending an email later, when zip is done
 return {
     "result": "ok",
     "message": "Your file is being prepared, use the link to download file after couple of   minutes",
     "download_link": download_link
 }
```

The processing lambda "lambda_download_analytics.lambda_handler" would iterate over the date range to download data from S3 analytics bucket into '/tmp' location (of the lambda ephemeral space), zip the files, and upload to a 'tmp' prefix in S3 with a pre-defined name matching with what API caller was sent back as the download link for the file.

The name of the zip is '<message_id>.zip' - same file name is used when creating pre signed URL for the user to download.


```python
os.makedirs('/tmp', exist_ok=True)
delete_files_in_directory('/tmp') # implement your logic

# Iterate over the date range
current_date = datetime.strptime(start_date, "%Y-%m-%d").date()
end_date = datetime.strptime(end_date, "%Y-%m-%d").date()

s3 = boto3.client('s3')

# Define the S3 bucket and object key
bucket_name = 'ANALYTICS_BUCKET' # implement your code

# download for both inclusive dates
while current_date <= end_date:
  prefix = f"my_analytics/year={current_date.year}/month={current_date.strftime('%B')}/day={current_date.day}"
  f_name = f"{current_date.year}-{current_date.strftime('%B')}-{current_date.day}"
  current_date += timedelta(days=1)

  print(f'listing contents under prefix {prefix}')
  response = s3.list_objects_v2(Bucket=bucket_name, Prefix=prefix)

  if 'Contents' in response:
      for obj in response['Contents']:
          key = obj['Key']
          download_name = f'{f_name}-{os.path.basename(key)}'
          download_name = os.path.join('/tmp', download_name)
          s3.download_file(bucket_name, key, download_name)
          print(f"    downloaded {key} as {download_nam
          at_least_one_file_found = Truee}")
  else:
      print("   no files found")

# name should align  as the pre signed
# URL was already generated for this name
# and sent back to caller when request was submitted
s3_key = f"tmp/{message_id}.zip"
# Create an in-memory bytes buffer
with io.BytesIO() as buffer:

  # zip buffer may be empty if no files were found in the given date range
  zip_files(buffer, "/tmp")

  if not at_least_one_file_found:
      print('no files were found in the given date range, empty zip file being created !!')

  s3.upload_fileobj(buffer, bucket_name, s3_key)
  print(f"Uploaded zip to s3://{bucket_name}/{s3_key}")

  delete_files_in_directory('/tmp')
```

