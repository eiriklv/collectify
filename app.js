var hl = require('highland');
var _ = require('lodash');
var async = require('async');
var asfy = require('asfy');
var mongoose = require('mongoose');
var helpers = require('./helpers');
var config = require('./config');
var setup = require('./setup');
var models = require('./models')(mongoose);

var options = {
  timeOut: 10000
};

var jsonMapper = require('json-mapper')(options);
var feedMapper = require('feed-mapper')(options);
var siteParser = require('site-parser')(options);

setup.connectToDatabase(mongoose, config.get('database.mongo.url'));

var query = {
  active: true
};

var queryFunction = models.Source.find.bind(models.Source, query);
var isEqual = hl.ncurry(2, _.isEqual);

var sourceStream = hl(helpers.sourceWrapper(queryFunction))
  .ratelimit(1, 1000)
  .take(10)
  .errors(helpers.handleErrors)
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
  .flatMap(
    hl.wrapCallback(
      jsonMapper.parse.bind(jsonMapper)
    )
  )

var rssStream = sourceStream
  .fork()
  .filter(
    hl.compose(
      isEqual('rss'),
      hl.get('type')
    )
  )
  .flatMap(
    hl.wrapCallback(
      feedMapper.parse.bind(feedMapper)
    )
  )

var siteStream = sourceStream
  .fork()
  .filter(
    hl.compose(
      isEqual('site'),
      hl.get('type')
    )
  )
  .flatMap(
    hl.wrapCallback(
      siteParser.parse.bind(siteParser)
    )
  )

var articleStream = hl([jsonStream, rssStream, siteStream])
  .merge()
  .flatten()
  .errors(helpers.handleErrors)

var newArticleStream = articleStream
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
  .each(hl.log)

var existingArticleStream = articleStream
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
  .each(hl.log)
