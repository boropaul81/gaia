/*jshint browser: true */
/*global define, console, plog, Notification */
define(function(require) {

  var appSelf = require('app_self'),
      evt = require('evt'),
      model = require('model'),
      mozL10n = require('l10n!'),
      notificationHelper = require('shared/js/notification_helper'),
      queryString = require('query_string');

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
    if (typeof Notification !== 'function') {
      console.log('email: notifications not available');
      sendNotification = function() {};
    } else {
      sendNotification = function(notificationId, title, body, iconUrl) {
        console.log('Notification sent for ' + notificationId);

        if (Notification.permission !== 'granted') {
          console.log('email: notification skipped, permission: ' +
                      Notification.permission);
          return;
        }

        //TODO: consider setting dir and lang?
        //https://developer.mozilla.org/en-US/docs/Web/API/notification
        var notification = new Notification(title, {
          body: body,
          icon: iconUrl,
          tag: notificationId
        });

        // If the app is open, but in the background, when the notification
        // comes in, then we do not get notifived via our mozSetMessageHandler
        // that is set elsewhere. Instead need to listen to click event
        // and synthesize an "event" ourselves.
        notification.onclick = function() {
          evt.emit('notification', {
            clicked: true,
            imageURL: iconUrl,
            tag: notificationId
          });
        };
      };
    }

    api.oncronsyncstart = function(accountIds) {
      console.log('email oncronsyncstart: ' + accountIds);
      var accountKey = makeAccountKey(accountIds);
      waitingOnCron[accountKey] = true;
    };

    function fetchExistingNotificationsData(fn) {
      if (typeof Notification !== 'function' || !Notification.get) {
        return fn({});
      }

      Notification.get().then(function(notifications) {
        var result = {};
        notifications.forEach(function(notification) {
          var imageUrl = notification.icon,
              data = queryString.toObject((imageUrl || '').split('#')[1]);
          data.notification = notification;
          result[data.accountId] = data;
        });
        fn(result);
      }, function(err) {
        // Do not care about errors, just log and keep going.
        console.error('email notification.get call failed: ' + err);
        fn({});
      });
    }

    /**
     * Helper to just get some environment data. Exists to
     * reduce the curly brace pyramid of doom and to normalize
     * existing notification info.
     * @param {Boolean} hasNotificationUpdates indicates if there will
     * be notification updates, so previous notifications are needed.
     * @param  {Function} fn function to call once env info
     * is fetched.
     */
    function fetchEnvironment(hasNotificationUpdates, fn) {
      // If no updates, then skip the wait for these APIs.
      if (!hasNotificationUpdates) {
        return setTimeout(fn);
      }

      appSelf.latest('self', function(app) {
        model.latestOnce('account', function(currentAccount) {
          fetchExistingNotificationsData(function(existingNotificationsData) {
            fn(app, currentAccount, existingNotificationsData);
          });
        });
      });
    }

    /**
     * Generates a list of unique top names sorted by most recent
     * sender first, and limited to a max number. The max number
     * is just to limit amount of work and likely display limits.
     * @param  {Array} latestInfos  array of result.latestMessageInfos.
     * Note: modifies result.latestMessageInfos via a sort.
     * @param  {Array} oldFromNames old from names from a previous
     * notification.
     * @return {Array} a maxFromList array of most recent senders.
     */
    function topUniqueFromNames(latestInfos, oldFromNames) {
      var names = [],
          maxCount = 3;

      // Get the new from senders from the result. First,
      // need to sort by most recent.
      // Note that sort modifies result.latestMessageInfos
      latestInfos.sort(function(a, b) {
       return b.date - a.date;
      });

      // Only need three unique names, and just the name, not
      // the full info object.
      latestInfos.some(function(info) {
        if (names.length > maxCount) {
          return true;
        }
        var newName = info.from;
        if (names.indexOf(newName) === -1) {
          names.push(newName);
        }
      });

      // Now add in old names to fill out a list of
      // max names.
      oldFromNames.some(function(name) {
        if (names.length > maxCount) {
          return true;
        }
        if (names.indexOf(name) === -1) {
          names.push(name);
        }
      });

      return names;
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

      fetchEnvironment(!!accountsResults.updates,
      function(app, currentAccount, existingNotificationsData) {
        if (accountsResults.updates) {
          var iconUrl = notificationHelper.getIconURI(app);

          accountsResults.updates.forEach(function(result) {
            // If the current account is being shown, then just send
            // an update to the model to indicate new messages, as
            // the notification will happen within the app for that
            // case.
            if (currentAccount.id === result.id && !document.hidden) {
              model.notifyInboxMessages(result);
              return;
            }

            // If this account does not want notifications of new messages
            // or if no Notification object, stop doing work.
            if (!model.getAccount(result.id).notifyOnNew ||
                typeof Notification !== 'function') {
              return;
            }

            var dataString, subject, body,
                count = result.count,
                oldFromNames = [],
                existingData = existingNotificationsData[result.id];
console.log('EXISTING: ' + JSON.stringify(existingData, null, '  '));
            // Adjust counts/fromNames based on previous notification
            if (existingData) {
              if (existingData.count) {
                count += parseInt(existingData.count, 10);
              }
              if (existingData.fromNames) {
                oldFromNames = existingData.fromNames.split('\n');
console.log('OLDFROMNAMES: ' + oldFromNames);
              }
            }

            if (count > 1) {
              // Multiple messages where synced.
console.log('CALLING TOP UNIQUE');
              // topUniqueFromNames modifies result.latestMessageInfos
              var newFromNames = topUniqueFromNames(result.latestMessageInfos,
                                                    oldFromNames);
console.log('newFromNames: ' + newFromNames);
              dataString = queryString.fromObject({
                type: 'message_list',
                accountId: result.id,
                count: count,
                // Using \n as a separator since dataString needs to
                // be serialized to a string and need to pick an
                // unlikely character in names. Technically, from
                // names could have a \n, but highly unlikely, and
                // not a catastrophic failure if it happens.
                fromNames: newFromNames.join('\n')
              });

              if (model.getAccountCount() === 1) {
                subject = mozL10n.get('new-emails-notify-one-account', {
                  n: count
                });
              } else {
                subject = mozL10n.get('new-emails-notify-multiple-accounts', {
                  n: count,
                  accountName: result.address
                });
              }

              body = newFromNames.join(mozL10n.get('senders-separation-sign'));
            } else {
              // Only one message to notify about.
              var info = result.latestMessageInfos[0];
              dataString = queryString.fromObject({
                type: 'message_reader',
                accountId: info.accountId,
                messageSuid: info.messageSuid,
                count: 1,
                fromNames: info.from
              });

              if (model.getAccountCount() === 1) {
                subject = info.subject;
                body = info.from;
              } else {
                subject = mozL10n.get('new-emails-notify-multiple-accounts', {
                  n: count,
                  accountName: result.address
                });
                body = mozL10n.get('new-emails-notify-multiple-accounts-body', {
                  from: info.from,
                  subject: info.subject
                });
              }
            }

            sendNotification(
              result.id,
              subject,
              body,
              iconUrl + '#' + dataString
            );
          });
        }

        evt.emit('cronSyncStop', accountsResults.accountIds);

        // Mark this accountId set as no longer waiting.
        var accountKey = makeAccountKey(accountsResults.accountIds);
        waitingOnCron[accountKey] = false;
        var stillWaiting = Object.keys(waitingOnCron).some(function(key) {
          return !!waitingOnCron[key];
        });

        if (!hasBeenVisible && !stillWaiting) {
          var msg = 'mail sync complete, closing mail app';
          if (typeof plog === 'function') {
            plog(msg);
          } else {
            console.log(msg);
          }

          window.close();
        }
      });
    };

    // When inbox is viewed, be sure to clear out any possible notification
    // for that account.
    evt.on('inboxShown', function(accountId) {
      fetchExistingNotificationsData(function(notificationsData) {
        if (notificationsData.hasOwnProperty(accountId)) {
          notificationsData[accountId].notification.close();
        }
      });
    });
  });
});
