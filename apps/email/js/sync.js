/*jshint browser: true */
/*global define, console, plog, Notification */
define(function(require) {

  var appSelf = require('app_self'),
      evt = require('evt'),
      model = require('model'),
      mozL10n = require('l10n!'),
      notificationHelper = require('shared/js/notification_helper'),
      fromObject = require('query_string').fromObject;

  model.latestOnce('api', function(api) {
    var hasBeenVisible = !document.hidden,
        waitingOnCron = {};

    // Let the back end know the app is interactive, not just
    // a quick sync and shutdown case, so that it knows it can
    // do extra work.
    if (hasBeenVisible) {
      api.setInteractive();
    }

    // If the page is ever not hidden, then do not close it later.
    document.addEventListener('visibilitychange',
      function onVisibilityChange() {
        if (!document.hidden) {
          hasBeenVisible = true;
          api.setInteractive();
        }
    }, false);

    // Creates a string key from an array of string IDs. Uses a space
    // separator since that cannot show up in an ID.
    function makeAccountKey(accountIds) {
      return 'id' + accountIds.join(' ');
    }

    var sendNotification;
    if (typeof Notification === 'undefined') {
      console.log('email: notifications not available');
      sendNotification = function() {};
    } else {
      sendNotification = function(notificationId, title, body, iconUrl) {
        notificationHelper.send(title, body, iconUrl);

        /*
        // TODO: explore this pathway for notification revocation, by using
        // the "tag" on the notification options. Does not work right now --
        // notification is triggered, but clicking on it generates an error
        // in system app.
        if (Notification.permission !== 'granted') {
          console.log('email: notification skipped, permission: ' +
                      Notification.permission);
          return;
        }

        //TODO: consider setting dir and lang
        //https://developer.mozilla.org/en-US/docs/Web/API/notification
        var notification = new Notification(title, {
          body: body,
          icon: iconUrl,
          tag: notificationId
        });
        */
      };
    }

    api.oncronsyncstart = function(accountIds) {
      console.log('email oncronsyncstart: ' + accountIds);
      var accountKey = makeAccountKey(accountIds);
      waitingOnCron[accountKey] = true;
    };

    function makeNotificationDesc(infos) {
      // For now, just list who the mails are from, as there is no formatting
      // possibilities in the existing notifications for the description
      // section. Even new lines do not seem to work.
      var froms = [];

      infos.forEach(function(info) {
        if (froms.indexOf(info.from) === -1)
          froms.push(info.from);
      });
      return froms.join(', ');
    }

    /*
    accountsResults is an object with the following structure:
      accountIds: array of string account IDs.
      updates: array of objects includes properties:
        id: accountId,
        name: account name,
        count: number of new messages total
        latestMessageInfos: array of latest message info objects,
        with properties:
          - from
          - subject
          - accountId
          - messageSuid
     */
    api.oncronsyncstop = function(accountsResults) {
      console.log('email oncronsyncstop: ' + accountsResults.accountIds);

      appSelf.latest('self', function(app) {

        model.latestOnce('account', function(currentAccount) {
          var iconUrl = notificationHelper.getIconURI(app);
          if (accountsResults.updates) {
            accountsResults.updates.forEach(function(result) {
              // If the current account is being shown, then do not
              // send notifications.
              // TODO: this may become more complicated when this
              // story is implemented:
              // https://bugzilla.mozilla.org/show_bug.cgi?id=892521
              if (currentAccount.id === result.id && !document.hidden)
                return;

              // If this account does not want notifications of new messages
              // stop doing work.
              if (!model.getAccount(result.id).notifyOnNew)
                return;

              var dataString;
              if (navigator.mozNotification) {
                if (result.count > 1) {
                  dataString = fromObject({
                    type: 'message_list',
                    accountId: result.id
                  });

                  sendNotification(
                    result.id,
                    mozL10n.get('new-emails', { n: result.count }),
                    makeNotificationDesc(result.latestMessageInfos),
                    iconUrl + '#' + dataString
                  );
                } else {
                  result.latestMessageInfos.forEach(function(info) {
                      dataString = fromObject({
                        type: 'message_reader',
                        accountId: info.accountId,
                        messageSuid: info.messageSuid
                      });

                    sendNotification(
                      result.id,
                      info.subject,
                      info.from,
                      iconUrl + '#' + dataString
                    );
                  });
                }
              }
              console.log('NEW MESSAGE: ' + JSON.stringify(result, null, '  '));
            });
          }
        });

        evt.emit('cronSyncStop', accountsResults.accountIds);

        // Mark this accountId set as no longer waiting.
        var accountKey = makeAccountKey(accountsResults.accountIds);
        waitingOnCron[accountKey] = false;
        var stillWaiting = Object.keys(waitingOnCron).some(function(key) {
          return !!waitingOnCron[key];
        });

        if (!hasBeenVisible && !stillWaiting) {
          var msg = 'mail sync complete, closing mail app';
          if (typeof plog === 'function')
            plog(msg);
          else
            console.log(msg);

          window.close();
        }
      });
    };

  });
});
