/**
 * Application logic that isn't specific to cards, specifically entailing
 * startup and eventually notifications.
 **/

/*jshint browser: true */
/*global define, require, console, confirm */

// set up loading of scripts.
require.config({
  paths: {
    mailapi: 'js/ext/mailapi',
    shared: '../../../shared',
    l10nbase: '../../../shared/js/l10n',
    l10n: '../../../shared/js/l10n_date'
  },
  shim: {
    l10n: {
      deps: ['l10nbase'],
      exports: 'navigator.mozL10n'
    }
  },
  scriptType: 'application/javascript;version=1.8',
  definePrim: 'prim'
});

// q shim for rdcommon/log, just enough for it to
// work. Just uses defer, promise, resolve and reject.
define('q', ['prim'], function (prim) {
  return {
    defer: prim
  };
});

define('mail-app', ['require', 'mail-common', 'api!fake', 'l10n'],
function (require, common, MailAPI, mozL10n) {

var Cards = common.Cards,
    activityCallback = null;

var App = {
  initialized: false,

  /**
   * Bind any global notifications, relay localizations to the back-end.
   */
  _init: function() {
    // If our password is bad, we need to pop up a card to ask for the updated
    // password.
    if (!MailAPI._fake) {
      MailAPI.onbadlogin = function(account, problem) {
        switch (problem) {
          case 'bad-user-or-pass':
            Cards.pushCard('setup-fix-password', 'default', 'animate',
                      { account: account, restoreCard: Cards.activeCardIndex },
                      'right');
            break;
          case 'imap-disabled':
            Cards.pushCard('setup-fix-gmail-imap', 'default', 'animate',
                      { account: account, restoreCard: Cards.activeCardIndex },
                      'right');
            break;
          case 'needs-app-pass':
            Cards.pushCard('setup-fix-gmail-twofactor', 'default', 'animate',
                      { account: account, restoreCard: Cards.activeCardIndex },
                      'right');
            break;
        }
      };

      MailAPI.useLocalizedStrings({
        wrote: mozL10n.get('reply-quoting-wrote'),
        originalMessage: mozL10n.get('forward-original-message'),
        forwardHeaderLabels: {
          subject: mozL10n.get('forward-header-subject'),
          date: mozL10n.get('forward-header-date'),
          from: mozL10n.get('forward-header-from'),
          replyTo: mozL10n.get('forward-header-reply-to'),
          to: mozL10n.get('forward-header-to'),
          cc: mozL10n.get('forward-header-cc')
        },
        folderNames: {
          inbox: mozL10n.get('folder-inbox'),
          sent: mozL10n.get('folder-sent'),
          drafts: mozL10n.get('folder-drafts'),
          trash: mozL10n.get('folder-trash'),
          queue: mozL10n.get('folder-queue'),
          junk: mozL10n.get('folder-junk'),
          archives: mozL10n.get('folder-archives')
        }
      });
    }
    this.initialized = true;
  },

  /**
   * Show the best inbox we have (unified if >1 account, just the inbox if 1) or
   * start the setup process if we have no accounts.
   */
  showMessageViewOrSetup: function(showLatest, isUpgradeCheck) {
    // Get the list of accounts including the unified account (if it exists)
    var acctsSlice = MailAPI.viewAccounts(false);
    acctsSlice.oncomplete = function() {
      // - we have accounts, show the message view!
      if (acctsSlice.items.length) {
        // For now, just use the first one; we do attempt to put unified first
        // so this should generally do the right thing.
        // XXX: Because we don't have unified account now, we should switch to
        //       the latest account which user just added.
        var account = showLatest ? acctsSlice.items.slice(-1)[0] :
                                   acctsSlice.items[0];
        var foldersSlice = MailAPI.viewFolders('account', account);
        foldersSlice.oncomplete = function() {
          var inboxFolder = foldersSlice.getFirstFolderWithType('inbox');
          if (!inboxFolder)
            common.dieOnFatalError('We have an account without an inbox!',
                foldersSlice.items);

          if (isUpgradeCheck) {
            // Clear out old cards, start fresh
            Cards.removeCardAndSuccessors(null, 'none');
          } else {
            Cards.assertNoCards();
          }

          // Push the navigation cards
          Cards.pushCard(
            'folder-picker', 'navigation', 'none',
            {
              acctsSlice: acctsSlice,
              curAccount: account,
              foldersSlice: foldersSlice,
              curFolder: inboxFolder
            });
          // Push the message list card
          Cards.pushCard(
            'message-list', 'nonsearch', 'immediate',
            {
              folder: inboxFolder
            });
          if (activityCallback) {
            activityCallback();
            activityCallback = null;
          }
        };
      }
      // - no accounts, show the setup page!
      else if (!isUpgradeCheck) {
        acctsSlice.die();
        if (activityCallback) {
          var result = activityCallback();
          activityCallback = null;
          if (!result)
            return;
        }
        Cards.assertNoCards();
        Cards.pushCard(
          'setup-account-info', 'default', 'immediate',
          {
            allowBack: false
          });
      }

      if (!isUpgradeCheck) {
        require(['css!style/value_selector',
                 'css!style/compose-cards',
                 'css!style/setup-cards',
                 'value_selector',
                 'iframe-shims',
                 'setup-cards',
                 'compose-cards'
        ]);
      }

      // If have a fake API object, now dynamically load
      // the real one.
      if (MailAPI._fake) {
        require(['api!real'], function (api) {
          MailAPI = api;
          if (gotLocalized)
            doInit();
        });
      }
    };
  }
};

var queryURI = function _queryURI(uri) {
  function addressesToArray(addresses) {
    if (!addresses)
      return [''];
    addresses = addresses.split(';');
    var addressesArray = addresses.filter(function notEmpty(addr) {
      return addr.trim() !== '';
    });
    return addressesArray;
  }
  var mailtoReg = /^mailto:(.*)/i;

  if (uri.match(mailtoReg)) {
    uri = uri.match(mailtoReg)[1];
    var parts = uri.split('?');
    var subjectReg = /(?:^|&)subject=([^\&]*)/i,
    bodyReg = /(?:^|&)body=([^\&]*)/i,
    ccReg = /(?:^|&)cc=([^\&]*)/i,
    bccReg = /(?:^|&)bcc=([^\&]*)/i;
    var to = addressesToArray(decodeURIComponent(parts[0])),
    subject,
    body,
    cc,
    bcc;

    if (parts.length == 2) {
      var data = parts[1];
      if (data.match(subjectReg))
        subject = decodeURIComponent(data.match(subjectReg)[1]);
      if (data.match(bodyReg))
        body = decodeURIComponent(data.match(bodyReg)[1]);
      if (data.match(ccReg))
        cc = addressesToArray(decodeURIComponent(data.match(ccReg)[1]));
      if (parts[1].match(bccReg))
        bcc = addressesToArray(decodeURIComponent(data.match(bccReg)[1]));
    }
      return [to, subject, body, cc, bcc];

  }

};


var gotLocalized = (mozL10n.readyState === 'interactive') ||
                   (mozL10n.readystate === 'complete'),
    inited = false;

function doInit() {
  try {
    if (inited) {
      App._init();

      if (!MailAPI._fake) {
        // Real MailAPI set up now. We could have guessed wrong
        // for the fast path, particularly if this is an email
        // app upgrade, where they set up an account, but our
        // fast path for no account setup was not in place then.
        // In those cases, if we have accounts, need to switch
        // to showing accounts. This should only happen once on
        // app upgrade.
        App.showMessageViewOrSetup(null, true);
      }
    } else {
      inited = true;
      common.populateTemplateNodes();
      Cards._init();
      App._init();
      App.showMessageViewOrSetup();
    }
  }
  catch (ex) {
    console.error('Problem initializing', ex, '\n', ex.stack);
  }
}

if (!gotLocalized) {
  window.addEventListener('localized', function localized() {
    console.log('got localized!');
    gotLocalized = true;
    window.removeEventListener('localized', localized);
    doInit();
  });
} else {
  console.log('got localized via readyState!');
  doInit();
}

if ('mozSetMessageHandler' in window.navigator) {
  window.navigator.mozSetMessageHandler('activity',
                                        function actHandle(activity) {
    var activityName = activity.source.name;
    // To assist in bug analysis, log the start of the activity here.
    console.log('activity!', activityName);
    if (activityName === 'share') {
      var attachmentBlobs = activity.source.data.blobs,
          attachmentNames = activity.source.data.filenames;
    }
    else if (activityName === 'new' ||
             activityName === 'view') {
      // new uses URI, view uses url
      var parts = queryURI(activity.source.data.url ||
                           activity.source.data.URI),
        to = parts[0],
        subject = parts[1],
        body = parts[2],
        cc = parts[3],
        bcc = parts[4];
    }
    var sendMail = function actHandleMail() {
      var folderToUse;
      try {
        folderToUse = Cards._cardStack[Cards
          ._findCard(['folder-picker', 'navigation'])].cardImpl.curFolder;
      } catch (e) {
        console.log('no navigation found:', e);
        var req = confirm(mozL10n.get('setup-empty-account-prompt'));
        if (!req) {
          // We want to do the right thing, but currently this won't even dump
          // us in the home-screen app.  This is because our activity has
          // disposition: window rather than inline.
          activity.postError('cancelled');
          // So our workaround is to close our window.
          window.close();
          return false;
        }
        return true;
      }
      var composer = MailAPI.beginMessageComposition(
        null, folderToUse, null,
        function() {
          /* to/cc/bcc/subject/body all have default values that shouldn't be
          clobbered if they are not specified in the URI*/
          if (to)
            composer.to = to;
          if (subject)
            composer.subject = subject;
          if (body && typeof body === 'string')
            composer.body = { text: body };
          if (cc)
            composer.cc = cc;
          if (bcc)
            composer.bcc = bcc;
          if (attachmentBlobs) {
            for (var iBlob = 0; iBlob < attachmentBlobs.length; iBlob++) {
              composer.addAttachment({
                name: attachmentNames[iBlob],
                blob: attachmentBlobs[iBlob]
              });
            }
          }
          Cards.pushCard('compose',
            'default', 'immediate', { composer: composer,
            activity: activity });
          activityLock = false;
        });
    };

    if (App.initialized) {
      console.log('activity', activityName, 'triggering compose now');
      sendMail();
    } else {
      console.log('activity', activityName, 'waiting for callback');
      activityCallback = sendMail;
    }
  });
}
else {
  console.warn('Activity support disabled!');
}

return App;

});

// Run the app module
require(['mail-app']);
