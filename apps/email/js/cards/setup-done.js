/*global define*/
define([
  'tmpl!./setup-done.html',
  'mail-common',
  'mail-app',
  'css!style/setup-cards'
], function (templateNode, common, App) {

var Cards = common.Cards;


/**
 * Setup is done; add another account?
 */
function SetupDoneCard(domNode, mode, args) {
  domNode.getElementsByClassName('sup-add-another-account-btn')[0]
    .addEventListener('click', this.onAddAnother.bind(this), false);
  domNode.getElementsByClassName('sup-show-mail-btn')[0]
    .addEventListener('click', this.onShowMail.bind(this), false);
}
SetupDoneCard.prototype = {
  onAddAnother: function() {
    // Nuke all cards
    Cards.removeAllCards();
    // Show the first setup card again.
    Cards.pushCard(
      'setup-account-info', 'default', 'immediate',
      {
        allowBack: true
      });
  },
  onShowMail: function() {
    // Nuke this card
    Cards.removeAllCards();
    // Trigger the startup logic again; this should show the inbox this time.
    App.showMessageViewOrSetup(true);
  },

  die: function() {
  }
};
Cards.defineCardWithDefaultMode(
    'setup-done',
    { tray: false },
    SetupDoneCard,
    templateNode
);


});