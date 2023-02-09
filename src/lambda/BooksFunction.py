import os
import sys
import json
import boto3
import argparse
import logging
from datetime import date, datetime
from requests_aws4auth import AWS4Auth
from gql import gql
from gql.client import Client
from gql.transport.requests import RequestsHTTPTransport

session = boto3.Session()

LOGGER = logging.getLogger()
if 'log_level' in os.environ:
    LOGGER.setLevel(os.environ['log_level'])
    print('Log level is set to %s' % LOGGER.getEffectiveLevel())
else:
    LOGGER.setLevel(logging.ERROR)

def json_serial(obj):
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    raise TypeError('Type %s not serializable' % type(obj))

def make_client(appsync_endpoint):
    headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    }

    credentials = session.get_credentials().get_frozen_credentials()
    auth = AWS4Auth(
        credentials.access_key,
        credentials.secret_key,
        session.region_name,
        'appsync',
        session_token=credentials.token
    )
    transport = RequestsHTTPTransport(url=appsync_endpoint,headers=headers,auth=auth)
    client = Client(transport=transport,fetch_schema_from_transport=True)
    return client

get_appsync_obj = """
query bookQuery($id: ID!) {
  getBook(id: $id) {
    id
    title
    shortdescription
    price
    rating
  }
}
"""

def test_get(client, id):
    params = { 'id': id }
    resp = client.execute(gql(get_appsync_obj), variable_values=json.dumps(params))
    return resp

create_appsync_obj = """
mutation createBook($input: CreateBookInput!) {
  createBook(input: $input) {
    id
    title
    shortdescription
    price
    rating
  }
}
"""

def test_mutation(client, title, shortdescription, price, rating):
    params = {
        "title": title,
        "shortdescription": shortdescription,
        "price": price,
        "rating": rating
    }
    resp = client.execute(gql(create_appsync_obj), variable_values=json.dumps({'input': params}))
    return resp

def create_book_details(event, client):
    resp = test_mutation(client, event['title'], event['shortdescription'], event['price'], event['rating'])
    print(json.dumps(resp))

def get_book_details(event, client):
    resp = test_get(client, event['id'])
    print(json.dumps(resp))

def index_handler(event, context):
    print(f"REQUEST RECEIVED: {json.dumps(event, default=str)}")
    client = make_client(os.environ['appsync_endpoint'])
    if 'op' in event:
        if event['op'] == 'create':
            create_book_details(event, client)
        elif event['op'] == 'get':
            get_book_details(event, client)
