var assert      = require('assert');
var Promise     = require('promise');
var path        = require('path');
var _           = require('lodash');
var base        = require('taskcluster-base');
var v1          = require('../routes/api/v1');
var exchanges   = require('../scheduler/exchanges');
var taskcluster = require('taskcluster-client');

// Load configuration
var cfg = base.config({
  defaults:     require('../config/defaults'),
  profile:      require('../config/test'),
  envs: [
    'aws_accessKeyId',
    'aws_secretAccessKey',
    'azure_accountName',
    'azure_accountKey',
    'pulse_username',
    'pulse_password'
  ],
  filename:     'task-graph-scheduler'
});

// Some default clients for the mockAuthServer
var defaultClients = [
  {
    // Loaded from config so we can authenticate against the real queue
    // Note, we still use a mock auth server to avoid having the scope
    // auth:credentials assigned to our test client
    clientId:     cfg.get('taskcluster:credentials:clientId'),
    accessToken:  cfg.get('taskcluster:credentials:accessToken'),
    scopes:       ['auth:credentials'],
    expires:      new Date(3000, 0, 0, 0, 0, 0, 0)
  }, {
    clientId:     'test-client',  // Used in default Scheduler creation
    accessToken:  'none',
    scopes:       ['*'],
    expires:      new Date(3000, 0, 0, 0, 0, 0, 0)
  }
];

/** Return a promise that sleeps for `delay` ms before resolving */
exports.sleep = function(delay) {
  return new Promise(function(accept) {
    setTimeout(accept, delay);
  });
}

/** Setup testing */
exports.setup = function(options) {
  // Provide default configuration
  options = _.defaults(options || {}, {
    title:      'untitled test'
  });

  // Create subject to be tested by test
  var subject = {};

  // Skip tests if no AWS credentials is configured
  if (!cfg.get('azure:accountKey') ||
      !cfg.get('taskcluster:credentials:accessToken') ||
      !cfg.get('pulse:password')) {
    console.log("Skip tests for " + options.title +
                " due to missing credentials!");
    return;
  }

  // Configure server
  var server = new base.testing.LocalApp({
    command:      path.join(__dirname, '..', 'bin', 'server.js'),
    args:         ['test'],
    name:         'server.js',
    baseUrlPath:  '/v1'
  });

  // Configure handlers
  var handlers = new base.testing.LocalApp({
    command:      path.join(__dirname, '..', 'bin', 'handlers.js'),
    args:         ['test'],
    name:         'handlers.js'
  });

  // Hold reference to mockAuthServer
  var mockAuthServer = null;

  // Hold reference to all listeners created with `subject.listenFor`
  var listeners = [];

  // Setup server
  setup(function() {
    // Utility function to listen for a message
    // Return an object with two properties/promises:
    // {
    //   ready:   Promise,  // Resolved when we've started to listen
    //   message: Promise   // Resolved when we've received a message
    // }
    subject.listenFor = function(binding) {
      // Create listener
      var listener = new taskcluster.PulseListener({
        credentials:      cfg.get('pulse')
      });
      // Track it, so we can close it in teardown()
      listeners.push(listener);
      // Bind to binding
      listener.bind(binding);
      // Wait for a message
      var gotMessage = new Promise(function(accept, reject) {
        listener.on('message', accept);
        listener.on('error', reject);
      });
      return {
        ready:      listener.resume(),
        message:    gotMessage
      };
    };
    // Create mock authentication server
    return base.testing.createMockAuthServer({
      port:     60072, // This is hardcoded into config/test.js
      clients:  defaultClients
    }).then(function(mockAuthServer_) {
      mockAuthServer = mockAuthServer_;
    }).then(function() {
      // Launch server
      var serverLaunched = server.launch().then(function(baseUrl) {
        // Create client for working with API
        subject.baseUrl = baseUrl;
        var reference = v1.reference({baseUrl: baseUrl});
        subject.Scheduler = taskcluster.createClient(reference);
        subject.scheduler = new subject.Scheduler({
          baseUrl:          baseUrl,
          credentials: {
            clientId:       'test-client',
            accessToken:    'none'
          }
        });
        // Create client for binding to reference
        var exchangeReference = exchanges.reference({
          exchangePrefix:   cfg.get('scheduler:exchangePrefix'),
          credentials:      cfg.get('pulse')
        });
        subject.SchedulerEvents = taskcluster.createClient(exchangeReference);
        subject.schedulerEvents = new subject.SchedulerEvents();

        // Create queueEvents and Queue client
        subject.queue = new taskcluster.Queue({
          baseUrl:          cfg.get('taskcluster:queueBaseUrl'),
          credentials:      cfg.get('taskcluster:credentials')
        });
        subject.queueEvents = new taskcluster.QueueEvents({
          exchangePrefix:   cfg.get('taskcluster:queueExchangePrefix')
        });
      });

      return Promise.all([serverLaunched, handlers.launch()]);
    });
  });

  // Shutdown server
  teardown(function() {
    // Kill server and handlers
    return Promise.all([
      handlers.terminate(),
      server.terminate()
    ]).then(function() {
      return mockAuthServer.terminate();
    }).then(function() {
      return Promise.all(listeners.map(function(listener) {
        return listener.close();
      })).then(function() {
        listeners = [];
      });
    });
  });

  return subject;
};
