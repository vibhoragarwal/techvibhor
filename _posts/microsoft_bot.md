---
title: "All about Microsoft Bot Framework (Python), Streaming Content & Azure Deployment for GenAI powered Chatbots"
excerpt: "Building a teams bot with Python Microsoft Bot framework is challenging. Here is an end to end guide to follow."
coverImage: "/assets/blog/microsoft_bot/microsoft_bot_title.png"
date: "2024-09-12T15:35:07.322Z"
author:
  name: Vibhor Agarwal
  picture: "/assets/blog/authors/techvibhor.png"
ogImage:
  url: "/assets/blog/microsoft_bot/microsoft_bot_title.png"

---

![](/assets/blog/microsoft_bot/microsoft_bot_title.png) 

# Bot framework 


When creating chatbots with Microsoft based technologies, there are few considerations:

[Microsoft Documentation on Bots](https://learn.microsoft.com/en-us/microsoftteams/playbook/technology-choices/pvavsazurebot)

Microsoft offers two different technologies for building chatbot solutions: **Azure AI Bot Services (formerly known as Azure Bot Framework)**, a traditional software SDK,
and **Microsoft Copilot Studio**, a modern low-code approach for building chatbots.

When comparing with Copilot studio, a low code platform, when requiring higher level of customizations & control, and when need to integrate with teams,
**Azure Bot services** are the preferred option. It seems **Copilot** has more focus from Microsoft as of now, and is possible in future that Copilot
offers the missing features that are there today on Azure Bot. Keep an eye on developments here.

*Microsoft Bot Framework and Azure AI Bot Service are a collection of libraries, tools, and services that let you build, test, deploy,
and manage intelligent bots. The Bot Framework includes a modular and extensible SDK for building bots and connecting to AI services.
With this framework, developers can create bots that use speech, understand natural language, answer questions, and more.*

We will take example of a sample Python bot build with Microsoft Bot Framework and then understand the components, improve it, enhance it
and finally understand deployment on Azure.

A bot is nothing but a web application hosting APIs that client (such as teams or chat interface) can talk to.
But has additional capabilities to handle messaging, maintaining user conversations and state, allowing concurrent request handling, messaging life cycle,
integration with Cloud, interceptors/middleware when working with messages, sending cards such as to collect feedback from user, multichannel support etc.

Microsoft SDK for Bot will provide these services, and is supported in C#, Java, Typescript and Python.

All frameworks may not have equal functionality and may differ in terms of support. C# is the preferred option and is expected to be kept up-to-date by Microsoft
, but this guide would use Python Bot framework SDK.


## Objective

When working with Microsoft Bot framework in Python, several challenges were seen w.r.to SDKs, documentation and commonly used features.
This article attempts to describe and provide solutions for each of them, and also describes deployment on Azure, for newbies.


## Take one Python sample from Microsoft and build on top of it

This is what you should be already aware of, at least a bit !

[Microsoft Bot Framework](https://learn.microsoft.com/en-us/azure/bot-service/index-bf-sdk?view=azure-bot-service-4.0)

Here is the sample, take any sample, we would customize it.

[Echo Bot](https://github.com/microsoft/BotBuilder-Samples/tree/main/samples/python/02.echo-bot)

You can run the bot locally by installing an emulator:

[Running locally with Emulator](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-debug-emulator?view=azure-bot-service-4.0&tabs=csharp)


**app.py** is the entry point to run the bot. You would check out the code, create a virtual env (python 3.11), activate it,  install required dependencies
and then run   

```commandline
python3 app.py
```
   

Now access the emulator and use the local running server's link : http://localhost:3978/api/messages to talk to back end via emulator interface.
Once have this working, continue reading.


## What are we going to do next

Well, a basic bot is useless unless we build a full fledge app and deploy it on cloud.

We can deploy this probably on any cloud as the deployment is nothing but a **web app** (on AWS can be run on ECS Fargate, on Azure as App Service -> WebApp)
But you still need the **Azure Bot Service** as the middleware to complete the deployment; this servie would integrate with the user channels while using **web app** as the
chat messaging end point. The **web app** can then have any logic to respond to user queries.

Here are our requirements:

 - update basic bot to a production ready version
 - use User Managed Service Identity for the bot
 - handle exceptions from BOT as well as the back end API gracefully
 - fix SDK issues that were experienced with this **not so robust** framework
 - some unit & deploy tests around the bot (will leave up to you to use **pytest** and add them)
 - use python 3.11 (instead of default provided in sample), upgraded dependencies etc
 - streaming - no clue if SDK really supports it or not ? But here, we implement a solid workaround **working** and **production tested** solution !
 - understand & implement web app and bot service deployment

Also, some Azure integrations:

 - robust persistence of user state (state management) on Azure Cosmos (you can use Blob)
 - and read Cosmos DB connection details from a Key Vault created for the bot
 - integrate with existing App Insights instance to send the logs, read the connection string from this Key Vault secret
 - integrate bot with back end API (URL & key to API as Key Vault secrets) that would actually serve user queries


Add some tests:

 - unit tests mocking back end API
 - deploy tests (post deployment) to verify if app is up ?


Here is the architecture that we try to build:

![microsoft_bot.png](/assets/blog/microsoft_bot/microsoft_bot.png)

A bot is nothing but an API hosted on Azure App service (as web app) in this example.

The API needs a framework to be able to use tools to build, test, and connect bots that interact naturally with users, wherever they are.
Microsoft Bot Framework provides that. We will use Python SDK.


Though we would not create a teams channel, a user on teams channel would connect with **Azure Bot service** which will talk to the web app that we would build.
The web app would connect with Cosmos for state management, and will need an **App Service plan** that can provide compute to it.
Azure Bot service has the capability to connect several channels to the Bot and acts as a middleware.
This is a special service on Azure under "Microsoft.BotService/botServices".


## Bot code and components

Below code extracts will give you more than boilerplate code and fixes to model your bot as per your needs.
Any LOGGER statements are expected to send the logs to integrated App Insights instance.

### Update requirements as below

requirements.txt
```text
botbuilder-core
aiohttp
botbuilder-integration-aiohttp
python-dotenv
botbuilder-azure
azure-cosmos
azure-identity
azure-keyvault-secrets
azure-monitor-opentelemetry
```
We will use async programming as much as we can.

Here notice we do not have versions for dependencies; reason is to keep the app up to date with latest versions, patches and fixes for subsequent deployments.

'python-dotenv' is to load configuration from **.env** file which we will keep locally containing confidential info such as credentials to **Azure Cosmos** or
**back end API**. This should ideally go into **Azure Key Vault** but we can for now, configure them on **Azure App Service** environment.

When you deploy this as web app to Azure, ".env" file would not be deployed, instead the 'python-dotenv' would try to look up
in the environment settings of the web app deployment on Azure to fetch these attributes.



requirements-test.txt
```text
-r requirements.txt
flask
pytest
faker
aioresponses
pytest-asyncio
requests
```
You can run this file:

```commandline
pip install -r requirements-test.txt
```

on your venv (create with **python 3.11**) which installs the test dependencies also on local virtual env so that you can run your tests from your IDE or CLI.
But when deploying **requirements.txt** file would be used and dependencies installed. This means we can avoid installing redundant testing dependencies
on actual deployment when tests are to be run locally on 'deploying environment' and not at runtime of the app !

### Back end API exception & response handler

Since we would use a back end API that does the actual answering of our queries, we need to handle API exceptions/response; build classes for them.

```python

# api_exception.py
class APIException(Exception):

   def __init__(self, status_code, message, request_id):
       self.status_code = status_code
       self.message = message
       self.request_id = request_id
       super().__init__(f"API Error: {status_code} - {message} (Request ID: {request_id})")

# api_response.py
class APIResponse():
     def __init__(self, text, request_id):
           self.text = text
           self.request_id = request_id
```

### Custom show typing middleware with typing animation fix

A defect seen in framework was - when 'typing' is used to show users of their request being processed and processing (any code in the bot) fails or any reason, the 'typing' activities
are still thrown to bot interface and is never stopped even when communication has actually stopped.

A success scenario has no issue.

An ingenious way to overcome this defect is to override the default **ShowTypingMiddleware** by copying original code and fixing it.
The fix is just to warp the bot's execution logic's call in a try-finally, to be able to clear the timer to stop it !

Create a new file : **custom_typing_middleware.py**

```python

"""
extended original 'ShowTypingMiddleware' to be able to wrap logic() call in exception, to clear timer to stop showing typing in case of exception
"""

# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
import asyncio
from typing import Awaitable, Callable

from botbuilder.core import TurnContext, ShowTypingMiddleware
from botbuilder.core.show_typing_middleware import Timer
from botbuilder.schema import Activity, ActivityTypes


class CustomShowTypingMiddleware(ShowTypingMiddleware):
   """
   When added, this middleware will send typing activities back to the user when a Message activity
   is received to let them know that the bot has received the message and is working on the response.
   You can specify a delay before the first typing activity is sent and then a frequency, which
   determines how often another typing activity is sent. Typing activities will continue to be sent
   until your bot sends another message back to the user.
   """

   def __init__(self, delay: float = 0.5, period: float = 2.0):
       super().__init__(delay, period)

   async def on_turn(
           self, context: TurnContext, logic: Callable[[TurnContext], Awaitable]
   ):
       timer = Timer()

       def start_interval(context: TurnContext, delay, period):
           async def aux():
               typing_activity = Activity(
                   type=ActivityTypes.typing,
                   relates_to=context.activity.relates_to,
               )

               conversation_reference = TurnContext.get_conversation_reference(
                   context.activity
               )

               typing_activity = TurnContext.apply_conversation_reference(
                   typing_activity, conversation_reference
               )

               asyncio.ensure_future(
                   context.adapter.send_activities(context, [typing_activity])
               )

               # restart the timer, with the 'period' value for the delay
               timer.set_timeout(aux, period)

           # first time through we use the 'delay' value for the timer.
           timer.set_timeout(aux, delay)

       def stop_interval():
           timer.set_clear_timer()

       # Start a timer to periodically send the typing activity
       # (bots running as skills should not send typing activity)
       if (
               context.activity.type == ActivityTypes.message
               and not CustomShowTypingMiddleware._is_skill_bot(context)
       ):
           start_interval(context, self._delay, self._period)

       # ONLY CHANGE FROM ORIGINAL MIDDLEWARE CODE
       # ENSURE THE TIMER IS CLEARED
       try:
           # Call the bot logic
           result = await logic()
       except Exception as e:
           # catch and raise as is but clear the timer.
           raise e
       finally:
           stop_interval()

       return result

```


### Create connection to read secrets Key Vault

Create a secret utils to read all secrets from a given key vault.
Assume we want to use existing app insights connection from back end system which also provided client with API URL and password.
The bot's logs needs to be integrated in main workflow for seamless log tracing.

But say, the bot itself uses its own Cosmos DB for persisting user states and infra as code would save the connection string in
a key vault used and owned by bot (independent of others).

Note here the use of 'managed identity' that has permissions to use key vault !
When creating bot with IaC, we would create this identity and assign permissions later.


```python
"""
Module to connect to Key vault to retrieve secrets
Need GET & LIST permissions on the key vault to the managed_identity_client_id
"""
import os
from logging import getLogger

from azure.identity.aio import DefaultAzureCredential
from azure.keyvault.secrets.aio import SecretClient

LOGGER = getLogger("my_bot.secret_utils")


async def get_app_insights_conn_string():
    # dedicated new key vault for bot which we create using IaC code later and add secrets
    key_vault_name = os.getenv("BOT_KEY_VAULT_NAME")
    return await get_secrets(key_vault_name, 'app-insights-key')

async def get_backend_api_secrets():
    # dedicated new key vault for bot which we create using IaC code later and add secrets
    key_vault_name = os.getenv("BOT_KEY_VAULT_NAME")
    return await get_secrets(key_vault_name, 'back-end-api-url', 'back-end-api-passsword')


async def get_cosmos_secrets():
    # dedicated new key vault for bot which we create using IaC code later and add secrets
    key_vault_name = os.getenv("BOT_KEY_VAULT_NAME")
    return await get_secrets(key_vault_name, 'teams-bot-cosmos-endpoint', 'teams-bot-cosmos-key')


async def get_secrets(key_vault_name, *secret_names):
    # Retrieve Key Vault name from environment variable
    managed_identity_client_id = os.getenv("AZURE_CLIENT_ID")
    LOGGER.info(f"retrieving secrets from {key_vault_name}, for new connection,"
                f" AZURE_CLIENT_ID retrieved {managed_identity_client_id is not None}")
    secrets = []
    try:
        async with DefaultAzureCredential(managed_identity_client_id=managed_identity_client_id) as credential:
            async with SecretClient(vault_url=f"https://{key_vault_name}.vault.azure.net",
                                    credential=credential) as client:
                for secret_name in secret_names:
                    LOGGER.info(f' fetching value for {secret_name}')
                    secret = await client.get_secret(secret_name)
                    secrets.append(secret.value)
    except Exception as e:
        LOGGER.error(f"An error occurred while retrieving secrets from vault {key_vault_name}: {e}")
        return (None,) * len(secret_names)

    return tuple(secrets)

```



### User state persistence 

Since we deploy this on Azure, we need a robust storage for user state.

In the sample you checked out, user state is persisted in memory. If your deployment is running for long time, memory would be filled and is not a good option for persistence and scalbility

We can use Azure Cosmos DB (we added dependencies already). This library will take care of storing the state in Cosmos and reading it when needed; all what we need
is to give it a Cosmos DB connection. 
Cosmos comes in 2 flavours - serverless mode and provisioned throughput. Short summary from AI:

    - Serverless: This option is ideal for workloads with intermittent or unpredictable traffic.
      You are charged only for the request units (RUs) consumed by your database operations and the storage used.
      It’s great for development, testing, and applications with bursty traffic patterns.

    - Provisioned Throughput (PTU): This option is best for workloads with sustained traffic that require predictable performance.
      You commit to a certain amount of throughput (expressed in RUs per second) that is provisioned on your databases and containers.
      Billing is based on the amount of throughput you provision, regardless of actual usage.

With PTU, the cosmos library has no issue. With the serverless option, client cannot set a throughput on the storage.
SDK has a defect where it always uses **throughput=400** which makes the Cosmos calls fail !

The fix along with the entire implementation is below. You need to set the secrets for the Cosmos connection in the key vault for the bot (IaC will do this later)

```python
"""
Module to configure Cosmos connection for storage
"""
import os
from logging import getLogger

from azure.cosmos import PartitionKey
from azure.cosmos.aio import CosmosClient, DatabaseProxy, ContainerProxy
from botbuilder.azure import CosmosDbPartitionedStorage, CosmosDbPartitionedConfig
from botbuilder.core import Storage

from bots.secret_uils import get_cosmos_secrets

# Constants for Cosmos DB configuration
COSMOS_DB = 'mybot'

if 'DEPLOYMENT_STAGE' in os.environ:
    COSMOS_DB = COSMOS_DB + f'-{os.environ.get("DEPLOYMENT_STAGE")}'

COSMOS_DB_CONTAINER = 'userstates'

LOGGER = getLogger("my_bot.cosmos_storage")


async def get_cosmos_storage() -> Storage:
    """ create the cosmos DB and container for partitioned storage

    Returns: CosmosDbPartitionedStorage
    """

    cosmos_endpoint, cosmos_key = await get_cosmos_secrets()

    # Ensure the Cosmos DB credentials are available
    if not cosmos_endpoint or not cosmos_key:
        LOGGER.error("missing secret settings for CosmosDB connection !")
        raise ValueError("COSMOS_ENDPOINT and COSMOS_KEY must be provided in the secrets")

    # Initialize Cosmos DB client
    async with CosmosClient(cosmos_endpoint, cosmos_key) as cosmos_client:
        # Create database and container if they do not exist
        database: DatabaseProxy = await cosmos_client.create_database_if_not_exists(id=COSMOS_DB)
        _container: ContainerProxy = await database.create_container_if_not_exists(
            id=COSMOS_DB_CONTAINER,
            partition_key=PartitionKey(path='/id')
        )

        # Configure Cosmos DB partitioned storage
        config = CosmosDbPartitionedConfig(
            cosmos_db_endpoint=cosmos_endpoint,
            auth_key=cosmos_key,
            database_id=COSMOS_DB,
            container_id=COSMOS_DB_CONTAINER,
            container_throughput=None,  # SDK defaults to 400 which is not supported on serverless Cosmos
        )

        # Create Cosmos DB storage instance
        cosmos_storage = CosmosDbPartitionedStorage(config)

    LOGGER.info('cosmos connection initialized')
    return cosmos_storage

```

### Conversation state persistence

You can implement this on similar lines, but ideally if you have a stateless back end API that probably uses a LLM to generate responses, your back end should
maintain the conversational context when it receives queries and it responds. 

In the response, it can send back a reference ID to the client, for it to sent back to itself, in subsequent API calls, so that back end can 
use the ID to fetch the conversational context (say from Cosmos) and add it to the LLM call as **chat history**


### Back end API client program

It may look like this. Do not worry about un-used arguments.

We would use them to build streaming later.

```python


from logging import getLogger

import aiohttp
from botbuilder.core import TurnContext

from bots.api_exception import APIException
from bots.api_response import APIResponse

LOGGER = getLogger("my_bot.back_end_api")

class MyRealBackEndAPIClient:
    
   def __init__(self, api_url=None, api_key=None):

        self.API_BASE_URL = api_url
        self.secret = api_key
        # add others
       
       
   async def query(self, user_profile: dict, question: str, turn_context: TurnContext, is_update_activity_supported=True):
       bot_user_id = user_profile["bot_user_id"]
       LOGGER.info(f"processing query {question} from user {bot_user_id}")
       async with aiohttp.ClientSession() as session:
           async with session.post(
               f"{self.API_BASE_URL}/query",
               headers={"Content-Type": "application/json",
                        "Accept": "text/markdown", # for streaming change to application/x-ndjson
                        "SecretHeader": self.secret,# pseudo code, change based on your API
                        },
               json={
                   "query": question
               }
           ) as response:
               status_code = response.status
               request_id = response.headers['X-Request-ID']
               if 200 <= status_code <= 299:
                   output = await response.text()
                   return APIResponse(text=output, request_id=request_id) # build response object as needed
               raise APIException(status_code, await response.text(), request_id)
           
    # add other API methods as you need


```


### Back end API client program - mocked

When building the bot app, you would not want to load the back end API & increase cost & latency for your local development.
Simulate the back end with a small local application that can probably send fixed responses.


```python

"""
module that mocks non streaming API response returning fixed markdown response
"""
import asyncio
import uuid

from botbuilder.core import TurnContext
from bots.api_response import APIResponse

class MockedFixedApiClient:

   def __init__(self):
       self.mocked = True
       self.answer = load_markdown_file()

   async def query(self, user_profile: dict, question: str, turn_context: TurnContext, is_update_activity_supported=True):
       request_id = uuid.uuid4()
       print(f"mocked mode {self.mocked}, returning fixed non streaming .md response "
             f" for this request id {request_id} in few seconds..")
       await asyncio.sleep(8)
       return APIResponse(text=self.answer, request_id=request_id) # object as desired



def load_markdown_file():
   # your markdown containing a fixed response that you spit out when in mocked mode, when building your bot code
   with open('bots/mocked/mocked_response.md', 'r', encoding='utf-8') as file:
       content = file.read()
   return content

```

### A class to handle user profile and other utitity functions.

**utils.py**

```python
from logging import getLogger

from botbuilder.core import TurnContext, StatePropertyAccessor, UserState

BOT_EMULATOR_CHANNELS = ['webchat', 'emulator']
LOGGER = getLogger("my_bot.utils")


async def get_user_profile(turn_context: TurnContext, user_profile_accessor: StatePropertyAccessor):
    # Retrieve the user profile from state storage, or initialize it if it doesn't exist
    user_profile = await user_profile_accessor.get(turn_context, default_value_or_factory={})
    if not user_profile:
        user_profile = {}
    # Ensure the user profile contains a bot_user_id
    if "bot_user_id" not in user_profile:
        user_profile["bot_user_id"] = turn_context.activity.from_property.id

    # Save the updated user profile back to state storage
    await user_profile_accessor.set(turn_context, user_profile)
    return user_profile


async def save_user_profile(turn_context: TurnContext,
                            user_profile_accessor: StatePropertyAccessor,
                            user_profile: dict,
                            user_state: UserState):
    # save to cache
    await user_profile_accessor.set(turn_context, user_profile)
    LOGGER.info(user_profile)
    # persist to storage
    await user_state.save_changes(turn_context)
```


### The Bot itself

Few things to note:

When building a teams bot, even before creating a teams channel and integrating your bot there, you would build and test locally
on your emulator. 

When you are done, and you deploy on Azure, you can use Azure Bot's service's 'Test in web chat' option to again test
the deployed code. 

For both these 'test' channels, update and delete of activity is **NOT supported**.

So after a request-response cycle, if you perform action say -  delete an activity (or update), it would not work on test channels but would on actual Microsoft Teams.

Below, **on_turn()** was overridden just to capture the channel, to configure if the channel supports update/delete of activity or not !
This we would use for a workaround streaming solution that we build little later.

Also, we try to create transaction trace for tracking in app insights.

**my_bot.py**

```python


import os
from botbuilder.core import ActivityHandler, MessageFactory, TurnContext, CardFactory, UserState, ConversationState, \
    StatePropertyAccessor
from botbuilder.schema import ChannelAccount


from mocked.api.mock_fixed_api_client import MockedFixedApiClient

from api.client import MyRealBackEndAPIClient
from logging import getLogger
from opentelemetry import trace
from opentelemetry.trace import SpanKind
from utils import get_user_profile, save_user_profile

channel_id = None

# known emulator channels; update activity does not work for them
# 'msteams' is the channel for MS Teams
BOT_EMULATOR_CHANNELS = ['webchat', 'emulator']
LOGGER = getLogger("my_bot.MyBot")

def get_api(api_url: str, api_key: str):
    run_mocked = os.environ.get("MOCKED_MODE", "false")
    if run_mocked.lower() == "true":
        print('running in mocked mode')
        print(' mocked mode will use emit fixed content as the back end API')
        backend_api = MockedFixedApiClient()
    else:
        # actual live call
        print('running live')
        backend_api = MyRealBackEndAPIClient(api_url, api_key)
    return backend_api


class MyBot(ActivityHandler):
    
    def __init__(self, user_state: UserState, conversation_state: ConversationState, api_url: str, api_key: str):
        self.backend_api = get_api(api_url, api_key)
        self.does_channel_supports_update_activity = True
        self.user_state = user_state
        self.conversation_state = conversation_state
        # create UserProfile property within the UserState.
        self.user_profile_accessor: StatePropertyAccessor = self.user_state.create_property("UserProfile")
        self.tracer = trace.get_tracer("my.my_bot")

    async def on_turn(self, turn_context: TurnContext):
        # This method is called for every activity
        global channel_id
        # Check and store channel ID only once
        if channel_id is None:
            channel_id = turn_context.activity.channel_id
            if channel_id in BOT_EMULATOR_CHANNELS:
                self.does_channel_supports_update_activity = False

        await super().on_turn(turn_context)


    async def on_members_added_activity(self, members_added: [ChannelAccount], turn_context: TurnContext):
        for member in members_added:
            if member.id != turn_context.activity.recipient.id:
                await turn_context.send_activity("Welcome message...")
                LOGGER.info(f'added member {member.id}')
                await self.reset_user_state(turn_context)

    async def reset_user_state(self, turn_context: TurnContext):
        user_profile = await self.get_user_profile(turn_context, self.user_profile_accessor)
        if "custom1" in user_profile:
            del user_profile["custom1"]
        if "custom2" in user_profile:
            del user_profile["custom2"]
        
        await save_user_profile(turn_context, self.user_profile_accessor, user_profile, self.user_state)

    async def on_message_activity(self, turn_context: TurnContext):
        user_input = turn_context.activity.text
        # just a pointer for you, when you sent a card/form etc, user response is captured here
        # store additional data or payloads that might be sent along with the activity. 
        additional_data = turn_context.activity.value
        message_id = turn_context.activity.id
        
        with self.tracer.start_as_current_span(name=f"my_bot.on_message_activity[{message_id}]",
                                               kind=SpanKind.CLIENT):
            LOGGER.info(f'received message with id: {message_id}')
            user_profile = await get_user_profile(turn_context, self.user_profile_accessor)

            return await self.handle_query(turn_context, user_input, user_profile)


    async def handle_query(self, turn_context: TurnContext, user_input: str, user_profile: dict):

        # send the TurnContext also, to allow sending message activities on the context when using streaming mode
        api_response: APIResponse = await self.backend_api.query(user_profile=user_profile,
                                                 question=user_input,
                                                 turn_context=turn_context,
                                                 is_update_activity_supported=self.does_channel_supports_update_activity)
        # exception from API would be handled by app.py-> on_error method
        # if response was already streamed, expect None as text
        answer = api_response.text
        if answer:
            # if there was response that was not sent; send it now
            await turn_context.send_activity(MessageFactory.text(answer))
        # just a pointer for you to use this in your next action if you need so, just like user_profile you may need to update
        request_id = api_response.request_id
        
        # example - api call sent back a request id that I persist
        user_profile["request_id"] = request_id
        await save_user_profile(turn_context, self.user_profile_accessor, user_profile, self.user_state)
```


## Configure application insights

**app_insights.py** - configure opentelemetry for the bot.
Feel free to change as desired.

```python

from azure.monitor.opentelemetry import configure_azure_monitor

from bots.secret_uils import get_app_insights_conn_string


async def configure_monitoring():
    # get back a tuple of array
    app_insights_conn_string = await get_app_insights_conn_string()
    app_insights_conn_string = app_insights_conn_string[0]
    configure_azure_monitor(logger_name="my_bot",
                            connection_string=app_insights_conn_string,
                            instrumentation_options={"azure_sdk": {"enabled": False},
                                                     "flask": {"enabled": False},
                                                     "psycopg2": {"enabled": False},
                                                     "django": {"enabled": False},
                                                     "fastapi": {"enabled": False}
                                                     },
                            disable_logging=False,
                            disable_tracing=False,
                            disable_metrics=False
                            )
```


## Prepare main application configuration

**config.py**

Web App environment settings would contain these settings when we deploy the infrastructure.

```python
import os

class DefaultConfig:
    """ Bot Configuration """
    PORT = 3978

    # these variables will set the path for credentials workflow
    # /site-packages/botbuilder/integration/aiohttp/configuration_service_client_credential_factory.py

    # these are set in environment of the Azure Web App where this code gets deployed
    APP_ID = os.environ.get("MicrosoftAppId", "")
    APP_PASSWORD = os.environ.get("MicrosoftAppPassword", "")

    APP_TYPE = os.environ.get("MicrosoftAppType", "MultiTenant")
    APP_TENANTID = os.environ.get("MicrosoftAppTenantId", "")
```


## Integrate it in main app

**app.py** - main entry point for the Bot whether you run locally on an emulator or use web chat on Azure Bot service

There are few important things to note here:

 - this is the entry point for the bot for any deployment
 - on emulator, you actually run this program and **main** is executed. This means you can run in mocked mode with this command:

```commandline
python3 app.py --mocked
```

 - for any exception, **on_error** is invoked. Handle your exceptions and user messages here.
 - you will now use Cosmos DB for user state management.
 - you will now use a custom middleware which has a 'typing animation' fix embedded.
 - when the app is deployed on Azure, remember that Azure webapp **WOULD NOT** execute **main**; it has its own command to run this program, but its is NOT **main** that gets executed
   This means **APP = web.Application** will be created for ALL modes (emulator or real deployment), but **web.run_app** is ONLY done for emulator.
   Azure will use the "gunicorn" WSGI to run the app with command below, defined in the deployment ARM scripts
      
```commandline
gunicorn --bind 0.0.0.0 --worker-class aiohttp.worker.GunicornWebWorker --timeout 600 app:APP
```   
   
   The "APP" after "app:" should match your object name below that instantiates **web.Application**

```python
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
import argparse
import asyncio
import os
import sys
import traceback
from datetime import datetime, timezone
from http import HTTPStatus
from logging import getLogger
from aiohttp import web
from aiohttp.web import Request, Response, json_response
from botbuilder.core import (
   ConversationState,
   TurnContext,
   UserState, )
from botbuilder.core.integration import aiohttp_error_middleware
from botbuilder.integration.aiohttp import CloudAdapter, ConfigurationBotFrameworkAuthentication
from botbuilder.schema import Activity, ActivityTypes
from dotenv import load_dotenv

from bots import MyBot
from bots.api_exception import APIException
from bots.cosmos_storage import get_cosmos_storage
from bots.custom_typing_middleware import CustomShowTypingMiddleware

from bots.secret_uils import get_backend_api_secrets
from config import DefaultConfig
from app_insights import configure_monitoring
load_dotenv()



LOGGER = getLogger("my_bot.app")
logging.basicConfig(stream=sys.stderr, level=logging.INFO)


asyncio.run(configure_monitoring())


# Catch-all for errors.
async def on_error(context: TurnContext, error: Exception):
   # This check writes out errors to console log .vs. app insights.
   # NOTE: In production environment, you should consider logging this to Azure
   #       application insights.

   print(f"\n [on_turn_error] unhandled error: {error}", file=sys.stderr)
   traceback.print_exc()

   # Send a message to the user
   if isinstance(error, APIException):
       # you are showing the API error directly, assuming back end API throws back friendly user messages
       await context.send_activity(f"{error.message} (Request-id: {error.request_id})")
   else:
       await context.send_activity("...bot failed...for request id :".format(context.activity.id))

   # Send a trace activity if we're talking to the Bot Framework Emulator
   # sent only to the Emulator and not to any other client or channel.
   if context.activity.channel_id == 'emulator':
       # Create a trace activity that contains the error object
       trace_activity = Activity(
           label="TurnError",
           name="on_turn_error Trace",
           timestamp=datetime.now(timezone.utc),
           type=ActivityTypes.trace,
           value=f"{error}",
           value_type="https://www.botframework.com/schemas/error",
       )
       # Send a trace activity, which will be displayed in Bot Framework Emulator
       await context.send_activity(trace_activity)


CONFIG = DefaultConfig()

# Create adapter.
# See https://aka.ms/about-bot-adapter to learn more about how bots work.
ADAPTER = CloudAdapter(ConfigurationBotFrameworkAuthentication(CONFIG))

ADAPTER.on_turn_error = on_error
ADAPTER.use(CustomShowTypingMiddleware(1, 2))


async def init_bot():
   print(f'initializing MyBot..')

   # Create cosmos document DB instance to persist user state
   storage = await get_cosmos_storage()

   # conversation state should be maintained in back end, not on bot
   # for now this is not used on the bot and object never interacted with
   conversation_state = ConversationState(storage)

   # this when used in memory can result in crash when memory runs out
   # needed to be offloaded to Cosmos
   user_state = UserState(storage)

   
   api_url, api_password = await get_backend_api_secrets()
   
   # this is called in azure deployment
   # Bot instance initially None
   bot = MyBot(user_state, conversation_state, api_url, api_password)
   print('bot created')
   return bot


# Listen for incoming requests on /api/messages
async def messages(req: Request) -> Response:
   # Main bot message handler.
   content_type = req.headers["Content-Type"]
   if "application/json" in content_type:
       body = await req.json()
   else:
       print(f"unsupported media type: {content_type}")
       return Response(status=HTTPStatus.UNSUPPORTED_MEDIA_TYPE)

   activity = Activity().deserialize(body)
   auth_header = req.headers["Authorization"] if "Authorization" in req.headers else ""

   response = await ADAPTER.process_activity(auth_header, activity, BOT.on_turn)
   if response:
       return json_response(data=response.body, status=response.status)
   return Response(status=HTTPStatus.OK)


APP = web.Application(middlewares=[aiohttp_error_middleware])

if __name__ == "__main__":
   # this is called for emulator, not for azure deployment
   print('main')
   parser = argparse.ArgumentParser(description="Run the web app with optional mocked parameter.")
   parser.add_argument('--mocked', action='store_true', help='Mock back end function')
   parser.add_argument('--api-url', type=str, help='API to use that mocks as back end API')
   args = parser.parse_args()

   # set the mocked mode here for the emulator
   os.environ["MOCKED_MODE"] = str(args.mocked) or "false"
   os.environ["MOCKED_MODE_BACKEND_API_URL"] = args.api_url or ""

# Router needs bot to be inited
BOT = asyncio.run(init_bot())
APP.router.add_post("/api/messages", messages)

if __name__ == "__main__":
   web.run_app(APP, host="localhost", port=CONFIG.PORT)
```

You should be ready to go with mocked or real mode, with Cosmos & App Singhts integration and a working clean Bot with Python SDK.
We will use **--api-url** a little later to mock a streaming back end API, and test the streaming as far as we can before you move
the tested code back to main back end API client. Example demonstrates how to capture a streaming back end API's response on bot interface; but it depends on
your back end API on whether and how it implements streaming !



## STREAMING MODE

Though Microsoft Bot framework claims to support streaming for both C# and Python SDKs, its quite disappointing that there is no sample, blog or
any example on how to use it.

For below, I did not find any example and dumped it !
Keep an eye on updates on examples, if you can find real streaming example.

[Python lib for streaming in Bot](https://pypi.org/project/botframework-streaming/)

At the moment, this library seems to be either not in use or even under development. The links here to the source code also do not work !!
Surprisingly, even for the C# version, no concrete example and guide was available and looks to be in total mess.

## STREAMING MODE - Workaround

In absence of real streaming implementation, a possible **working** workaround can be to send updated content to a bot's activity to make it "look like"
as if, it is streaming !!

The back end API in our example should support this.

The concept is that if there are 26 chunks (a to z) that are sent by back end API (for example, generative AI may be streaming tokens, just like on Copilot), then
we send to the bot interface:

**a** to a new activity that is created with id say "ACT_ID"


**a + b** to update the same activity with id "ACT_ID"


**a + b + c** to update the same activity with id "ACT_ID"


**a + b + c + d** to update the same activity with id "ACT_ID"


**a + b + c + d + e** to update the same activity with id "ACT_ID"

and so on.


This **wil** work but of course, update of activity is not possible as on date on emulator or web chat, so we cannot really test it 
unless we integrate this with "msteams" channel. What we would experience with the example below on emulator/web chat is new activities being spit out on the
channel, each having additional content !

This approach has a drawback that you end up re-sending data again and again which was already sent out - so more data transfer out from Cloud, a little overhead & cost !


### Create a mocked streaming API

We had added 'flask' already on test requirements, will use flask to simulate streaming response.

Let us assume API would receive chunks of data from a LLM. A data chunk can be in your required format, for example as below.
The mocked API below based on the "Accept" header, either streams the data or just return entire response in single chunk !

**response_stream.jsonl**
```json lines

{"content":"*Gen AI Streaming*\n___\n","type":"md"}
{"content":"","type":"md"}
{"content":"","type":"md"}
{"content":"","type":"md"}
{"content":"","type":"md"}
{"content":"The","type":"md"}
{"content":" Hero","type":"md"}
{"content":" **","type":"md"}
{"content":"Amit","type":"md"}
{"content":"abh","type":"md"}
{"content":"-","type":"md"}
{"content":"Bacch","type":"md"}
{"content":"an","type":"md"}
{"content":"","type":"md"}
{"content":"**","type":"md"}
{"content":" does","type":"md"}
{"content":" not","type":"md"}
{"content":" has","type":"md"}
{"content":" any movies","type":"md"}
{"content":" in year **","type":"md"}
{"content":"2024","type":"md"}
{"content":"**","type":"md"}
{"content":":\\n\\n","type":"md"}
{"content":"**","type":"md"}
{"content":"End of content","type":"md"}
{"content":"**","ended":true,"type":"md"}
```

**mocked_streaming_api.py**
```python
"""
this program simulates a local Flask app based back end AP
"""
import os
import time
import json
import uuid

from flask import Flask, request, Response, jsonify, stream_with_context, send_file

app = Flask(__name__)

# this is some markdown content file
def load_markdown_file(f_path):
    with open(f_path, 'r', encoding='utf-8') as file:
        content = file.read()
    return content


def read_jsonl_file(file_path='response_stream.jsonl'):
    data = []
    with open(file_path, 'r', encoding='utf-8') as file:
        for line in file:
            data.append(json.loads(line.strip()))
    return data


markdown_chunks = read_jsonl_file()

# this is the real streaming with Flask by yielding
def generate_ndjson():
    for chunk in markdown_chunks:
        chunk = json.dumps(chunk) + '\n'
        print(chunk)
        # the real streaming simulation with this..
        yield chunk
        time.sleep(0.001)  # Simulate a delay in data generation

def add_headers(response):
    response.headers['X-Request-ID'] = uuid.uuid4()
    response.headers['x-response-status'] = 'success'

@app.route('/')
def index():
   print('Request for index page received')
   return jsonify({'result': 'ok'}), 200

@app.route('/query', methods=['POST'])
def ask():
    if 'Accept' in request.headers and request.headers['Accept'] == 'application/x-ndjson':
        response =  Response(stream_with_context(generate_ndjson()))
        add_headers(response)
        response.headers['Transfer-Encoding'] = 'chunked'
        return response
    else:
        # use some markdown file as you need
        file_name = 'mocked_flask_response.md'
        # Get the full path to the file
        full_path = os.path.abspath(file_name)
        if os.path.exists(full_path):
            response = Response(load_markdown_file(full_path), content_type='text/markdown')
            add_headers(response)
            return response
        else:
            return "Markdown file not found", 404

    return Response(stream_with_context(generate_ndjson()), content_type='application/x-ndjson')


if __name__ == '__main__':
    app.run(debug=True, port=5000)

```

**mocked_streaming_api_client.py**


```python
import json
import os

import aiohttp
from aiohttp import ClientResponse
from botbuilder.core import MessageFactory
from botbuilder.core import TurnContext
from botbuilder.schema import Activity

from bots.api_exception import APIException

class MockedStreamingApiClient:
    
   def __init__(self, api_url=None, api_key=None):
        self.API_BASE_URL = api_url
        self.secret = api_key
        self.mocked = True
        # control streaming behavior itself with these environment properties, without need to re-deploy code..
        self.stream_response = os.getenv("STREAM", "true") == "true"
        self.stream_chunk_size = int(os.getenv("STREAM_CHUNK_COLLECTION_SIZE", "8"))
       
   async def query(self, user_profile: dict, question: str, turn_context: TurnContext, is_update_activity_supported=True):
       bot_user_id = user_profile["bot_user_id"]
       print(f"processing query {question} from user {bot_user_id}")
       async with aiohttp.ClientSession() as session:
           async with session.post(
               f"{self.API_BASE_URL}/query",
               headers={"Content-Type": "application/json",
                        "Accept": "application/x-ndjson" if self.stream_response else "text/markdown", # for streaming change to application/x-ndjson
                        "SecretHeader": self.secret,# pseudo code, change based on your API
                        },
               json={
                   "query": question
               }
           ) as response:
               status_code = response.status
               print(status_code)
               request_id = response.headers['X-Request-ID']
               if 200 <= status_code <= 299:
                    if self.stream_response:
                        # with the right headers, response is expected to come in multiple chunks
                        # Desired behavior is to update the same response activity with incremented updated content
                        # but update (and delete) of activity does not work on webchat or emulator, then
                        # we send each incremented chunk as a new activity ( kind of test mode for streaming )
                        # If try to update activity on emulator/webchat, get an exception.
                        # None will be returned as output is already sent to channel !
                        output = await self.process_streaming_response(response, turn_context, is_update_activity_supported)
                    else:
                        # with the right headers, response is expected to come in single chunk as markdown
                        output = await response.text()
                    return APIResponse(output, request_id)
               raise APIException(status_code, await response.text(), request_id)
           

    async def process_streaming_response(self,
                                         response: ClientResponse,
                                         turn_context: TurnContext,
                                         is_update_activity_supported: bool):
        """ process streaming response

        Args:
            response: HTTP API response object
            turn_context: context for the current turn of the conversation
            is_update_activity_supported: only for 'msteams' channel this will be true, for 'emulator', 'webchat' not.
                                          Decides whether to try updating the activity with added data chunks or
                                          send a new activity

        Returns:
            None always
        """
        chunk = ""
        activity_id = None
        counter = 0
        
        lines_to_collect_before_sending = self.stream_chunk_size if self.stream_response else -1
        if lines_to_collect_before_sending == -1:
            print("sending single chunk of data as cannot update activity in emulator/webchat mode")
        else:
            print("sending several chunks of activities to the bot...")
        async for line in response.content:
            if line is None:
                # never expected here
                if chunk:
                    await create_or_update_activity(chunk, turn_context, activity_id, is_update_activity_supported)
                break

            # if data has Byte Order Mark, so need to use this. e.g b'{"body": " more", "done": false, "type": "text", "status": 200}\n'
            line_content = line.decode('utf-8-sig').strip()
            data = json.loads(line_content)
            is_last_chunk = True if "ended" in data else False

            body = data["content"]

            if not body:
                continue
            
            # possible that .md rendering has issues, such as rendering \\n as new line
            # parse your data as needed.
            body = str(body)
            body = body.replace("\\n", "\n")

            chunk += body
            if is_last_chunk or counter == lines_to_collect_before_sending:
                activity_id = await create_or_update_activity(chunk, turn_context, activity_id,
                                                              is_update_activity_supported)
                counter = 0
                if is_last_chunk:
                    break
            else:
                counter += 1

        return None


async def create_or_update_activity(text_to_send: str,
                                    turn_context: TurnContext,
                                    activity_id: str,
                                    is_update_activity_supported: bool) -> str:
    """ create or update activity
    Args:
        text_to_send: text in the activity
        turn_context: context for the current turn of the conversation
        activity_id: activity id to update
        is_update_activity_supported: True, then activity would be updated, else, just a new activity is sent

    Returns:
        performed activity action id
    """
    if not is_update_activity_supported:
        response = await turn_context.send_activity(MessageFactory.text(text_to_send))
        return response.id

    if not activity_id:
        response = await turn_context.send_activity(MessageFactory.text(text_to_send))
    else:
        updated_activity = Activity(
            type="message",
            id=activity_id,
            text=text_to_send
        )
        response = await turn_context.update_activity(updated_activity)
    return response.id
```

### Bring the mocked API up and point bot program to use the mocked API

```commandline
python mocked_streaming_api.py
```

   Spits out:

```commandline
* Serving Flask app 'app'
* Debug mode: on
WARNING: This is a development server. Do not use it in a production deployment. Use a production WSGI server instead.
* Running on http://127.0.0.1:5000
Press CTRL+C to quit
* Restarting with stat
* Debugger is active!
* Debugger PIN: 331-567-771
```


  Update the bot code in **my_bot.py** to use the new argument in the bot run command.



  ```python
  import os
  def get_api(api_url: str, api_key: str):
      run_mocked = os.environ.get("MOCKED_MODE", "false")
      if run_mocked.lower() == "true":
          print('running in mocked mode')
          mocked_api_url = os.environ.get("MOCKED_MODE_BACKEND_API_URL", None)
          if mocked_api_url:
              print(f' mocked mode will use {mocked_api_url} as the back end API')
              backend_api = MockedStreamingApiClient(mocked_api_url)
          else:
              print(' mocked mode will use emit fixed content as the back end API')
              backend_api = MockedFixedApiClient()
      else:
          # actual live call
          print('running live')
          backend_api = MyRealBackEndAPIClient(api_url, api_key)
      return backend_api
  ```

  Point to this mocked API server to test your streaming bot on emulator. You would see multiple incremented activities being thrown on the interface
  with the last one having complete data. Of course, we expected that, as we cannot update activity on the bot.
   
  ```commandline
  python3 app.py --mocked --api-url=http://localhost:5000
  ```

  Once satisfied, update your real client code with the updates tested in mocked API mode. !

## Testing

Apart from emulator, you can look at these options:

[Bot Test options](https://learn.microsoft.com/en-us/azure/bot-service/channel-connect-teams?view=azure-bot-service-4.0)


### How to you test your app that you hosted ?

To test the api with an external client which is not emulator or test web chat, we need a way to authenticate to the API.
However, a very smple naive way is to test GET on http://hosteddomain/api/messages, and expect 405 !
This does work always, as it ensures app is initialized !!
This test could take several minutes (about 10 minutes) for the app to be initialized to be able to give us back a 405.

Add a **tests/deploy/test_deploy.py**.

Here a '405' from a GET request is passed - this is good enough for us to know the app is up

```python
import os
import time

import requests


def test_get_app_up_and_running():
    app_service_name = os.environ.get("APP_SERVICE_NAME")
    assert app_service_name, "APP_SERVICE_NAME not set in env to create app deploy URL for tests !"
    slot = os.environ.get("APP_SERVICE_DEPLOYMENT_SLOT", None)
    if slot and slot == 'staging':
        app_service_name += '-staging'
        print('testing staging slot URL')
    url = f'https://{app_service_name}.azurewebsites.net/api/messages'
    print(f'test url is {url}')
    # takes hell lot of time to make the webapp functional

    timeout = 400  # Total timeout for the entire check
    check_interval = 5  # Time to wait between checks in seconds
    elapsed_time = 0

    while elapsed_time < timeout:
        try:
            response = requests.get(url, timeout=check_interval)
            assert response.status_code == 405
            print("Test passed: Received 405 Method Not Allowed.")
            break
        except requests.exceptions.Timeout:
            print("Request timed out, checking again...")
        except AssertionError:
            print(f"Received a different status code {response.status_code}, retrying...")

        time.sleep(check_interval)
        elapsed_time += check_interval

    if elapsed_time >= timeout:
        assert False, "Test failed: Timeout reached without receiving 405."
```

## Building Infra as Code to deploy what we built

See this blog to continue building BICEP templates for this solution.

[Infrastructure as Code with Azure Bicep - deploying app service, bot service with several Azure integrations](microsoft_bicep)
