exports = module.exports = function(mongoose) {
  var entrySchema = new mongoose.Schema({
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

  entrySchema.set('toObject', {
    transform: function(doc, ret, options) {
      // delete ret._id;
      delete ret.__v;
      // delete ret.createdAt; enable this if you do not want to update the expiry
    }
  });

  entrySchema.set('toJSON', {
    transform: function(doc, ret, options) {
      // delete ret._id;
      delete ret.__v;
      // delete ret.createdAt; enable this if you do not want to update the expiry
    }
  });

  // create the model for articles and return it
  return mongoose.model('entry', entrySchema);
};
