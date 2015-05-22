Collectify
==========

#### Introduction:
A functional streaming news aggregator with real-time distribution. Mostly for educative purposes.
(depends on `iojs` 1.x).

* `collector.js` will
  * store and update articles in a mongodb collection
  * publish data to applicable channels/listeners

* `api.js` will
  * expose the data (articles) stored in the database as a HTTP API

* `websocket-api.js` will
  * listen for data being piped into the _articles:created_ channel it listens to
  * expose that data real-time as a websocket api

* `error-processing.js` will
  * listen for data being piped to the _errors_ channel it listens to
  * collect all error messages from all you processes
  * handle errors any way you want (just logging for now)

(More docs coming..)

#### Install dependencies (some might need to use `sudo` for various reasons):
* `brew/apt-get install iojs`
* `brew/apt-get install redis`
* `brew/apt-get install mongodb`
* `npm install -g gulp`
* `npm install`


#### Development shellscript example for `collector`:
```sh
#!/bin/sh

export DEBUG="*" \
export NODE_ENV="development" \
export MONGO_URL="mongodb://localhost/collectify" \
export REDIS_URL='redis://localhost:6379' \
export REDIS_PREFIX='collectify'

node collector
```

#### Development shellscript example for `api`:
```sh
#!/bin/sh

export DEBUG="*" \
export NODE_ENV="development" \
export MONGO_URL="mongodb://localhost/collectify" \

node api
```

#### Development shellscript example for `websocket-api`:
```sh
#!/bin/sh

export DEBUG="*" \
export NODE_ENV="development" \
export REDIS_URL='redis://localhost:6379' \
export REDIS_PREFIX='collectify'

node websocket-api
```

#### Development shellscript example for `error-processing`:
```sh
#!/bin/sh

export DEBUG="*" \
export NODE_ENV="development" \
export REDIS_URL='redis://localhost:6379' \
export REDIS_PREFIX='collectify'

node error-processing
```
