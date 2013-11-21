/*global define, requestAnimationFrame */
define(function(require) {

var templateNode = require('tmpl!./folder_picker.html'),
    fldFolderItemNode = require('tmpl!./fld/folder_item.html'),
    fldAccountItemNode = require('tmpl!./fld/account_item.html'),
    FOLDER_DEPTH_CLASSES = require('folder_depth_classes'),
    common = require('mail_common'),
    date = require('date'),
    model = require('model'),
    mozL10n = require('l10n!'),
    Cards = common.Cards,
    bindContainerHandler = common.bindContainerHandler,
    addClass = common.addClass,
    removeClass = common.removeClass;

require('css!style/folder_cards');

function FolderPickerCard(domNode, mode, args) {
  this.domNode = domNode;

  this.foldersContainer =
    domNode.getElementsByClassName('fld-folders-container')[0];
  bindContainerHandler(this.foldersContainer, 'click',
                       this.onClickFolder.bind(this));

  domNode.getElementsByClassName('fld-nav-toolbar')[0]
    .addEventListener('click', this.onShowSettings.bind(this), false);

  domNode.getElementsByClassName('fld-header-back')[0]
    .addEventListener('click', this._closeCard.bind(this), false);

  this.foldersHeader = domNode.getElementsByClassName('fld-folders-header')[0];

  domNode.getElementsByClassName('fld-folders-header')[0]
      .addEventListener('click', this.toggleAccounts.bind(this), false);

  domNode.addEventListener('click', function(evt) {
    if (evt.originalTarget === domNode) {
      this._closeCard();
    }
  }.bind(this), false);

  this._boundUpdateAccount = this.updateAccount.bind(this);
  model.latest('account', this._boundUpdateAccount);

  this.accountsContainer =
    domNode.getElementsByClassName('fld-acct-list-container')[0];
  bindContainerHandler(this.accountsContainer, 'click',
                       this.onClickAccount.bind(this));

  this.acctsSlice = model.api.viewAccounts(false);
  this.acctsSlice.onsplice = this.onAccountsSplice.bind(this);
  this.acctsSlice.onchange = this.onAccountsChange.bind(this);
}
FolderPickerCard.prototype = {
  nextCards: ['settings_main', 'account_picker'],

  onShowSettings: function(evt) {
    Cards.pushCard(
      'settings_main', 'default', 'animate');
  },

  /**
   * Clicking a different account changes the list of folders displayed.  We
   * then trigger a select of the inbox for that account because otherwise
   * things get permutationally complex.
   */
  updateAccount: function(account) {
    var oldAccount = this.curAccount;

    this.mostRecentSyncTimestamp = 0;

    if (oldAccount !== account) {
      this.foldersContainer.innerHTML = '';

      model.latestOnce('folder', function(folder) {
        this.curAccount = account;

        // - DOM!
        this.updateSelfDom();

        // update header
        this.domNode
            .getElementsByClassName('fld-folders-header-account-label')[0]
            .textContent = account.name;

        // If no current folder, means this is the first startup, do some
        // work to populate the
        if (!this.curFolder) {
          this.curFolder = folder;
        }

        // Clean up any old bindings.
        if (this.foldersSlice) {
          this.foldersSlice.onsplice = null;
          this.foldersSlice.onchange = null;
        }

        this.foldersSlice = model.foldersSlice;

        // since the slice is already populated, generate a fake notification
        this.onFoldersSplice(0, 0, this.foldersSlice.items, true, false);

        // Listen for changes in the foldersSlice.
        // TODO: perhaps slices should implement an event listener
        // interface vs. only allowing one handler. This is slightly
        // dangerous in that other cards may access model.foldersSlice
        // and could decide to set these handlers, wiping these ones
        // out. However, so far folder_picker is the only one that cares
        // about these dynamic updates.
        this.foldersSlice.onsplice = this.onFoldersSplice.bind(this);
      }.bind(this));
    }
  },

  /**
   * Clicking a different account changes the list of folders displayed.  We
   * then trigger a select of the inbox for that account because otherwise
   * things get permutationally complex.
   */
  onClickAccount: function(accountNode, event) {
    var oldAccountId = this.curAccount.id,
        accountId = accountNode.account.id;

    this.curAccount = accountNode.account;

    if (oldAccountId !== accountId) {
      model.changeAccountFromId(accountId, function() {
        model.selectInbox(function() {
          this._closeCard();
        }.bind(this));
      }.bind(this));
    }
  },

  toggleAccounts: function() {
    if (this.accountsContainer.classList.contains('closed')) {
      this.showAccounts();
    } else {
      this.hideAccounts();
    }
  },

  showAccounts: function() {
    addClass(this.foldersContainer, 'closed');

    removeClass(this.foldersHeader, 'closed');
    removeClass(this.accountsContainer, 'closed');
  },

  hideAccounts: function() {
    addClass(this.foldersHeader, 'closed');
    addClass(this.accountsContainer, 'closed');

    removeClass(this.foldersContainer, 'closed');
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
                        null : accountsContainer.children[index];

    addedItems.forEach(function(account) {
      var accountNode = account.element =
        fldAccountItemNode.cloneNode(true);
      accountNode.account = account;
      this.updateAccountDom(account, true);
      accountsContainer.insertBefore(accountNode, insertBuddy);
    }.bind(this));

    if (accountsContainer.children.length < 2) {
      addClass(this.domNode, 'one-account');
    } else {
      removeClass(this.domNode, 'one-account');
    }

    // Wait for a bit since this is non-critical and do not want to disturb the
    // first animation showing the folder drawer.
    requestAnimationFrame(function() {
      var height = this.accountsContainer.getBoundingClientRect().height;
      if (height !== this.currentAccountContainerHeight) {
        this.currentAccountContainerHeight = height;

        // Get any translateY that is in effect for the folder list, to
        // maintain that offset after showing the account list.
        var offset = 20; //getComputedStyle(this.foldersContainer).transform;

        // offset is a matrix string value like matrix(1, 0, 0, 1, 0, 20),
        // just need the y translation, the last number.
        //offset  = /matrix\(([^)]+)\)/.exec(offset)[1].split(', ');
        //offset = parseInt(offset.pop(), 10);

        // Modify the translate offsets so that the account list only moves
        // as big as its contents. Need to wait for all known accounts to load
        // to know this for sure, so cannot place it in the CSS file.
        // However, if you change this section, consult folder_picker.css as
        // you will likely need to change the styles there too.
        var lastSheet = document.styleSheets[document.styleSheets.length - 1];
        [
          '.fld-acct-list-container.closed { transform: translateY(-' +
                                             height + 'px); }',
          '.fld-folders-container.closed { transform: translateY(' +
                                             (height + offset) + 'px);' +
                                           ' height: calc(100% - ' +
                                             (height + offset) + 'px); }'
        ].forEach(function(rule) {
          lastSheet.insertRule(rule, lastSheet.cssRules.length);
        });
      }
    }.bind(this));
  },

  onAccountsChange: function(account) {
    this.updateAccountDom(account, false);
  },

  updateAccountDom: function(account, firstTime) {
    var accountNode = account.element;

    if (firstTime) {
      accountNode.getElementsByClassName('fld-account-name')[0]
        .textContent = account.name;
    }
  },

  onFoldersSplice: function(index, howMany, addedItems,
                             requested, moreExpected) {
    var foldersContainer = this.foldersContainer;

    var folder;
    if (howMany) {
      for (var i = index + howMany - 1; i >= index; i--) {
        folder = this.foldersSlice.items[i];
        foldersContainer.removeChild(folder.element);
      }
    }

    var insertBuddy = (index >= foldersContainer.childElementCount) ?
                        null : foldersContainer.children[index],
        self = this;
    addedItems.forEach(function(folder) {
      var folderNode = folder.element = fldFolderItemNode.cloneNode(true);
      folderNode.folder = folder;
      self.updateFolderDom(folder, true);
      foldersContainer.insertBefore(folderNode, insertBuddy);
    });
  },

  updateSelfDom: function(isAccount) {
    var str = isAccount ? mozL10n.get('settings-account-section') :
      this.curAccount.name;
    this.domNode.getElementsByClassName('fld-folders-header-account-label')[0]
      .textContent = str;
  },

  updateFolderDom: function(folder, firstTime) {
    var folderNode = folder.element;

    if (firstTime) {
      if (!folder.selectable)
        folderNode.classList.add('fld-folder-unselectable');

      var depthIdx = Math.min(FOLDER_DEPTH_CLASSES.length - 1, folder.depth);
      folderNode.classList.add(FOLDER_DEPTH_CLASSES[depthIdx]);
      if (depthIdx > 0) {
        folderNode.classList.add('fld-folder-depthnonzero');
      }

      folderNode.getElementsByClassName('fld-folder-name')[0]
        .textContent = folder.name;
      folderNode.dataset.type = folder.type;
    }

    if (folder === this.curFolder)
      folderNode.classList.add('fld-folder-selected');
    else
      folderNode.classList.remove('fld-folder-selected');

    // XXX do the unread count stuff once we have that info
  },

  onClickFolder: function(folderNode, event) {
    var folder = folderNode.folder;
    if (!folder.selectable)
      return;

    var oldFolder = this.curFolder;
    this.curFolder = folder;
    this.updateFolderDom(oldFolder);
    this.updateFolderDom(folder);

    this._showFolder(folder);
    this._closeCard();
  },

  _closeCard: function() {
    Cards.removeCardAndSuccessors(this.domNode, 'animate');
  },

  /**
   * Tell the message-list to show this folder; exists for single code path.
   */
  _showFolder: function(folder) {
    model.changeFolder(folder);
  },

  /**
   * Our card is going away; perform all cleanup except destroying our DOM.
   * This will enable the UI to animate away from our card without weird
   * graphical glitches.
   */
  die: function() {
    this.acctsSlice.die();
    model.removeListener('account', this._boundUpdateAccount);
  }
};

Cards.defineCardWithDefaultMode('folder_picker', {},
                                FolderPickerCard, templateNode);

return FolderPickerCard;
});
