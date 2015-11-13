Collectify
==========

#### Introduction:
A functional streaming news aggregator with real-time distribution. Mostly for educative purposes.
(uses babel-node to support ES6+).

* `collector.js` will
  * store and update articles in a mongodb collection
  * publish data to applicable channels/listeners

* `api.js` will
  * expose the data (articles) stored in the database as a HTTP API

* `websocket-api.js` will
  * listen for data being piped into the _articles:*_ channel
  * expose that data real-time as a websocket api

* `error-processing.js` will
  * listen for data being piped to the _errors_ channel
  * collect all error messages from all you processes
  * handle errors any way you want (just logging for now)

(More docs coming..)

#### Example of of a template for collecting data/articles

```js
{
  "active": true,
  "type": "site",
  "name": "New Yorker",
  "url": "http://www.newyorker.com/",
  "format": "desktop",
  "template": {
    "containers": [{
      "selector": "article",
      "elements": [{
        "name": "guid",
        "type": "url",
        "occurence": "first",
        "required": true,
        "items": [{
          "selector": "section h2 a",
          "attribute": "href"
        }]
      }, {
        "name": "url",
        "type": "url",
        "occurence": "first",
        "required": true,
        "items": [{
          "selector": "section h2 a",
          "attribute": "href"
        }]
      }, {
        "name": "title",
        "required": true,
        "occurence": "first",
        "items": [{
          "selector": "section h2 a"
        }]
      }, {
        "name": "image",
        "type": "url",
        "occurence": "first",
        "fallback": null,
        "items": [{
          "selector": "figure a img",
          "attribute": "src"
        }, {
          "selector": "figure a img",
          "attribute": "data-lazy-src"
        }]
      }]
    }]
  }
}
```

#### Example of data collected

```js
{
  _source: 'New Yorker',
  _origin: 'http://www.newyorker.com/',
  _host: 'www.newyorker.com',
  guid: 'http://www.newyorker.com/culture/richard-brody/movie-of-the-week-the-marriage-circle',
  url: 'http://www.newyorker.com/culture/richard-brody/movie-of-the-week-the-marriage-circle',
  title: 'Movie of the Week: “The Marriage Circle”',
  image: 'http://www.newyorker.com/wp-content/assets/dist/img/header_graphics/contributors/brody.png',
  _ranking: 26,
  createdAt: 1447428348324,
  shares: {
    facebook: {
      url: 'http://www.newyorker.com/culture/richard-brody/movie-of-the-week-the-marriage-circle',
      normalized_url: 'http://www.newyorker.com/culture/richard-brody/movie-of-the-week-the-marriage-circle',
      share_count: 5,
      like_count: 15,
      comment_count: 6,
      total_count: 26,
      click_count: 0,
      comments_fbid: '964017293671043',
      commentsbox_count: 0
    },
    twitter: {
      count: 8,
      url: 'http://www.newyorker.com/culture/richard-brody/movie-of-the-week-the-marriage-circle/' },
    linkedin: {
      count: 0,
      fCnt: '0',
      fCntPlusOne: '1',
      url: 'http://www.newyorker.com/culture/richard-brody/movie-of-the-week-the-marriage-circle'
    }
  },
  content: '(Content from the article)...arose in 1981 over the director Ernst Lubitsch and his second Hollywood feature, “The Marriage Circle...',
  keywords: [
    'splendid',
    'controversy',
    'arose',
    'director',
    'ernst'
  ]
}
```

#### Install dependencies (some might need to use `sudo` for various reasons):
* `brew/apt-get install iojs`
* `brew/apt-get install redis`
* `brew/apt-get install mongodb`
* `npm install -g gulp`
* `npm install -g babel`
* `npm install`


#### Development shellscript example for `collector`:
```sh
#!/bin/sh

export DEBUG="*" \
export NODE_ENV="development" \
export MONGO_URL="mongodb://localhost/collectify" \
export REDIS_URL='redis://localhost:6379' \
export REDIS_PREFIX='collectify'

babel-node --stage 0 collector
```

#### Development shellscript example for `api`:
```sh
#!/bin/sh

export DEBUG="*" \
export NODE_ENV="development" \
export MONGO_URL="mongodb://localhost/collectify" \

babel-node --stage 0 api
```

#### Development shellscript example for `websocket-api`:
```sh
#!/bin/sh

export DEBUG="*" \
export NODE_ENV="development" \
export REDIS_URL='redis://localhost:6379' \
export REDIS_PREFIX='collectify'

babel-node --stage 0 websocket-api
```

#### Development shellscript example for `error-processing`:
```sh
#!/bin/sh

export DEBUG="*" \
export NODE_ENV="development" \
export REDIS_URL='redis://localhost:6379' \
export REDIS_PREFIX='collectify'

babel-node --stage 0 error-processing
```
