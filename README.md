Collectify
==========

#### Introduction:
A functional streaming news aggregator with real-time distribution. Mostly for educative purposes.

#### Install dependencies (some might need to use `sudo` for various reasons):
* `brew/apt-get install iojs`
* `brew/apt-get install redis`
* `brew/apt-get install mongodb`
* `npm install -g gulp`
* `npm install`

#### Run the application:
* Development: start either `collector` or `collector-transmitter` and `publisher` using the development scripts below
* Production: set environment variables and start applicable scripts

#### Development shellscript example for `collector` (collecting and saving):
```sh
#!/bin/sh

export DEBUG="*" \
export NODE_ENV="development" \
export MONGO_URL="mongodb://localhost/collectify" \
export REDIS_URL='redis://localhost:6379' \
export REDIS_PREFIX='collectify'

iojs collector
```

#### Development shellscript example for `collector-transmitter` (collecting, saving and publishing on redis):
```sh
#!/bin/sh

export DEBUG="*" \
export NODE_ENV="development" \
export MONGO_URL="mongodb://localhost/collectify" \
export REDIS_URL='redis://localhost:6379' \
export REDIS_PREFIX='collectify'

iojs collector-transmitter
```

#### Development shellscript example for `publisher`:
```sh
#!/bin/sh

export DEBUG="*" \
export NODE_ENV="development" \
export REDIS_URL='redis://localhost:6379' \
export REDIS_PREFIX='collectify'

iojs publisher
```
