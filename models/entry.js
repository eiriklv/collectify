const mongoose = require('mongoose');
const _ = require('lodash-fp');
const asap = require('asap');

const schema = new mongoose.Schema({
  _ranking: {
    type: Number,
    required: true,
    index: true
  },
  _source: {
    type: String,
    required: true,
    index: true
  },
  _origin: {
    type: String,
    required: true
  },
  _host: {
    type: String,
    required: true,
    index: true,
  },
  guid: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  url: {
    type: String,
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true
  },
  image: {
    type: String
  },
  content: {
    type: String
  },
  keywords: {
    type: [String]
  },
  shares: {
    type: mongoose.Schema.Types.Mixed
  },
  posted: {
    type: Date,
    default: Date.now,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 86400, // ttl in seconds
    required: true
  }
});

schema.set('toObject', {
  transform(doc, ret, options) {
    // delete ret._id;
    delete ret.__v;
    // delete ret.createdAt; enable this if you do not want to update the expiry
  }
});

schema.set('toJSON', {
  transform(doc, ret, options) {
    // delete ret._id;
    delete ret.__v;
    // delete ret.createdAt; enable this if you do not want to update the expiry
  }
});

schema.statics.formatForUpdate = function(picks) {
  return (obj, callback) => {
    asap(callback.bind(this, null, _.pick(picks, obj), obj))
  };
};

// create the model for articles and return it
module.exports = mongoose.model('entry', schema);
