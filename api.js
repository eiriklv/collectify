/**
 * Dependencies
 */
const debug = require('debug')('collectify:api');
const http = require('http');
const express = require('express');
const lodash = require('lodash-fp');
const async = require('async');
const util = require('util');
const mongoose = require('mongoose');
const app = express();

/**
 * Application-specific modules
 */
const config = require('./config');
const setup = require('./setup');

/**
 * Data Models (mongoose)
 */
const Entries = require('./models/entry');
const Sources = require('./models/source');

/**
 * Connect to the database
 */
setup.connectToDatabase(
  mongoose,
  config.get('database.mongo.url')
);

/**
 * Route for fetching
 * a collection of articles
 */
app.get('/articles', (req, res) => {
  //..TODO
});

/**
 * Route for fetching
 * a specific article
 */
app.get('/articles/:url', (req, res) => {
  //..TODO
});

/**
 * Start server
 */
app.listen(3001);
