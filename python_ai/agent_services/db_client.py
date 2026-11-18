import os
from dotenv import load_dotenv, find_dotenv
from pymongo import MongoClient
import redis

load_dotenv(find_dotenv())

mongo_url = os.getenv("MONGO_URL")
if not mongo_url:
    raise ValueError("MONGO_URL not set in .env")

mongo_client = MongoClient(mongo_url)

# Safely extract database name from connection string or fallback to "test"
try:
    db = mongo_client.get_default_database()
except Exception:
    db = mongo_client["test"]

redis_url = os.getenv("REDIS_URL")
r = redis.from_url(redis_url, decode_responses=True) if redis_url else None


def get_db():
    return db


def get_redis():
    return r
