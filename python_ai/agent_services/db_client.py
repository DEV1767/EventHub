import os
from dotenv import load_dotenv, find_dotenv
from pymongo import MongoClient
import redis

load_dotenv(find_dotenv())

_mongo_client = None
_db = None
_redis_client = None


def get_mongo_client():
    global _mongo_client
    if _mongo_client is None:
        mongo_url = os.getenv("MONGO_URL")
        if not mongo_url:
            raise ValueError("MONGO_URL not set in .env")
        _mongo_client = MongoClient(mongo_url)
    return _mongo_client


def get_db():
    global _db
    if _db is None:
        client = get_mongo_client()
        try:
            _db = client.get_default_database()
        except Exception:
            _db = client["test"]
    return _db


def get_redis():
    global _redis_client
    if _redis_client is None:
        redis_url = os.getenv("REDIS_URL")
        _redis_client = redis.from_url(redis_url, decode_responses=True) if redis_url else None
    return _redis_client


class _LazyDbProxy:
    def __getattr__(self, name):
        return getattr(get_db(), name)

    def __getitem__(self, name):
        return get_db()[name]


db = _LazyDbProxy()
