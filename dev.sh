#!/bin/sh
export PORT=3000 \
export DEBUG="*" \
export NODE_ENV="development" \
export MONGO_URL="mongodb://localhost/collectify" \

node app-transmitter
