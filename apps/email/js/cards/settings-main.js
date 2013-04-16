/*global define*/
define([
  'tmpl!./settings-main.html',
  'tmpl!./tng/account-item.html',
  'mail-common',
  'api',
  'css!style/setup-cards'
], function (templateNode, tngAccountItemNode, common, MailAPI) {

var Cards = common.Cards;

/**
 * Global settings, list of accounts.
 */
function SettingsMainCard(domNode, mode, args) {
  this.domNode = domNode;

  this.acctsSlice = MailAPI().viewAccounts(false);
  this.acctsSlice.onsplice = this.onAccountsSplice.bind(this);

  domNode.getElementsByClassName('tng-close-btn')[0]
    .addEventListener('click', this.onClose.bind(this), false);

  var checkIntervalNode =
    domNode.getElementsByClassName('tng-main-check-interval')[0];
console.log('  CONFIG CURRENTLY:', JSON.stringify(MailAPI().config));//HACK
  checkIntervalNode.value = MailAPI().config.syncCheckIntervalEnum;
  checkIntervalNode.addEventListener(
    'change', this.onChangeSyncInterval.bind(this), false);

  this.accountsContainer =
    domNode.getElementsByClassName('tng-accounts-container')[0];

  domNode.getElementsByClassName('tng-account-add')[0]
    .addEventListener('click', this.onClickAddAccount.bind(this), false);

  this._secretButtonClickCount = 0;
  this._secretButtonTimer = null;
  // TODO: Need to remove the secret debug entry before shipping.
  domNode.getElementsByClassName('tng-email-lib-version')[0]
    .addEventListener('click', this.onClickSecretButton.bind(this), false);
}
SettingsMainCard.prototype = {
  onClose: function() {
    Cards.removeCardAndSuccessors(this.domNode, 'animate', 1, 1);
  },

  onAccountsSplice: function(index, howMany, addedItems,
                             requested, moreExpected) {
    var accountsContainer = this.accountsContainer;

    var account;
    if (howMany) {
      for (var i = index + howMany - 1; i >= index; i--) {
        account = this.acctsSlice.items[i];
        accountsContainer.removeChild(account.element);
      }
    }

    var insertBuddy = (index >= accountsContainer.childElementCount) ?
                        null : accountsContainer.children[index],
        self = this;
    addedItems.forEach(function(account) {
      var accountNode = account.element =
        tngAccountItemNode.cloneNode(true);
      accountNode.account = account;
      self.updateAccountDom(account, true);
      accountsContainer.insertBefore(accountNode, insertBuddy);
    });
  },

  updateAccountDom: function(account, firstTime) {
    var accountNode = account.element;

    if (firstTime) {
      var accountLabel =
        accountNode.getElementsByClassName('tng-account-item-label')[0];

      accountLabel.textContent = account.name;
      accountLabel.addEventListener('click',
        this.onClickEnterAccount.bind(this, account), false);
    }
  },

  onChangeSyncInterval: function(event) {
    console.log('sync interval changed to', event.target.value);
    MailAPI().modifyConfig({
      syncCheckIntervalEnum: event.target.value });
  },

  onClickAddAccount: function() {
    Cards.pushCard(
      'setup-account-info', 'default', 'animate',
      {
        allowBack: true
      },
      'right');
  },

  onClickEnterAccount: function(account) {
    Cards.pushCard(
      'settings-account', 'default', 'animate',
      {
        account: account
      },
      'right');
  },

  onClickSecretButton: function() {
    if (this._secretButtonTimer === null) {
      var self = this;
      this._secretButtonTimer = window.setTimeout(
        function() {
          self._secretButtonTimer = null;
          self._secretButtonClickCount = 0;
        }.bind(this), 2000);
    }

    if (++this._secretButtonClickCount >= 5) {
      window.clearTimeout(this._secretButtonTimer);
      this._secretButtonTimer = null;
      this._secretButtonClickCount = 0;
      Cards.pushCard('settings-debug', 'default', 'animate', {}, 'right');
    }
  },

  die: function() {
    this.acctsSlice.die();
  }
};
Cards.defineCardWithDefaultMode(
    'settings-main',
    { tray: false },
    SettingsMainCard,
    templateNode
);


});