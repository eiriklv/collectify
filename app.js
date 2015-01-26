var hl = require('highland');
var _ = require('lodash');
var async = require('async');
var asfy = require('asfy');
var EventEmitter = require('events').EventEmitter;
var mongoose = require('mongoose');
var helpers = require('./helpers');
var config = require('./config');
var setup = require('./setup');
var models = require('./models')(mongoose);
var InterprocessTransmitter = require('interprocess-push-stream').Transmitter;

var eventEmitter = new EventEmitter();

var jsonMapper = require('json-mapper')({
  timeOut: 10000
});

var feedMapper = require('feed-mapper')({
  timeOut: 10000
});

var siteParser = require('site-parser')({
  timeOut: 10000
});

var existingChannel = InterprocessTransmitter({
  channel: 'articles:existing',
  prefix: config.get('database.redis.prefix'),
  url: config.get('database.redis.url')
});

var newChannel = InterprocessTransmitter({
  channel: 'articles:new',
  prefix: config.get('database.redis.prefix'),
  url: config.get('database.redis.url')
});

var errorChannel = InterprocessTransmitter({
  channel: 'error',
  prefix: config.get('database.redis.prefix'),
  url: config.get('database.redis.url')
});

var errorStream = _('error', eventEmitter);

var isEqual = hl.ncurry(2, _.isEqual);

var queryFunction = models.Source.find.bind(models.Source, {
  active: true
});

var sourceStream = hl(helpers.sourceWrapper(queryFunction))
  .ratelimit(1, 2000)
  .take(10)
  .errors(
    eventEmitter.emit.bind(
      eventEmitter,
      'error'
    )
  )
  .compact()
  .flatten()

var jsonStream = sourceStream
  .fork()
  .filter(
    hl.compose(
      isEqual('json'),
      hl.get('type')
    )
  )
  .map(
    hl.wrapCallback(
      jsonMapper.parse.bind(jsonMapper)
    )
  ).parallel(5)

var rssStream = sourceStream
  .fork()
  .filter(
    hl.compose(
      isEqual('rss'),
      hl.get('type')
    )
  )
  .map(
    hl.wrapCallback(
      feedMapper.parse.bind(feedMapper)
    )
  ).parallel(5)

var siteStream = sourceStream
  .fork()
  .filter(
    hl.compose(
      isEqual('site'),
      hl.get('type')
    )
  )
  .map(
    hl.wrapCallback(
      siteParser.parse.bind(siteParser)
    )
  ).parallel(5)

var articleStream = hl([jsonStream, rssStream, siteStream])
  .merge()
  .flatten()
  .errors(
    eventEmitter.emit.bind(
      eventEmitter,
      'error'
    )
  )

var newArticleStream = articleStream
  .fork()
  .flatFilter(
    hl.wrapCallback(
      async.compose(
        asfy(hl.not),
        asfy(helpers.isTruthy),
        models.Entry.count,
        asfy(hl.get('guid'))
      )
    )
  )

var existingArticleStream = articleStream
  .fork()
  .flatFilter(
    hl.wrapCallback(
      async.compose(
        asfy(helpers.isTruthy),
        models.Entry.count,
        asfy(hl.get('guid'))
      )
    )
  )

setup.connectToDatabase(
  mongoose,
  config.get('database.mongo.url')
);

newArticleStream
  .pipe(newChannel)

existingArticleStream
  .pipe(existingChannel)

errorStream
  .pipe(errorChannel)
