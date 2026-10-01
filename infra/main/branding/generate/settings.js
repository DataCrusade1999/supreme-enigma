// Writes the site's values over infra/main/branding.json in place. That file
// started as Cognito's full default settings (describe-managed-login-branding
// with --return-merged-resources); set() throws on a key it doesn't already
// have, so a typo can't add a setting Cognito would reject.
const fs = require('fs');
const path = require('path');
const dest = path.join(__dirname, '..', '..', 'branding.json');
const s = JSON.parse(fs.readFileSync(dest, 'utf8'));

function set(key, value) {
  const keys = key.split('.');
  let o = s;
  for (const k of keys.slice(0, -1)) {
    if (!(k in o)) throw new Error('missing key ' + k + ' in ' + key);
    o = o[k];
  }
  const last = keys[keys.length - 1];
  if (!(last in o)) throw new Error('missing key ' + last + ' in ' + key);
  o[last] = value;
}
// [path with {mode}, dark, light]
function both(key, dark, light) {
  set(key.replace('{mode}', 'darkMode'), dark);
  set(key.replace('{mode}', 'lightMode'), light);
}

const bg = ['131311ff', 'eceae5ff'];
const fg = ['eceae5ff', '111110ff'];
const muted = ['9a968cff', '5f5d57ff'];
const accent = ['5ec8c0ff', '146b64ff'];
const border = ['eceae552', '11111052'];

both('components.pageBackground.{mode}.color', ...bg);
both('components.pageHeader.{mode}.background.color', ...bg);
both('components.pageHeader.{mode}.borderColor', 'eceae5b8', '111110ff');
both('components.pageFooter.{mode}.background.color', ...bg);
both('components.pageFooter.{mode}.borderColor', 'eceae5b8', '111110ff');
both('components.form.{mode}.backgroundColor', '13131100', 'eceae500');
both('components.form.{mode}.borderColor', '13131100', 'eceae500');
both('components.pageText.{mode}.headingColor', ...fg);
both('components.pageText.{mode}.bodyColor', ...muted);
both('components.pageText.{mode}.descriptionColor', ...muted);
both('components.alert.{mode}.error.backgroundColor', '1f1412ff', 'f5e4e1ff');
both('components.alert.{mode}.error.borderColor', 'e2574cff', 'a8362aff');

both('components.primaryButton.{mode}.defaults.backgroundColor', ...fg);
both('components.primaryButton.{mode}.defaults.textColor', ...bg);
both('components.primaryButton.{mode}.hover.backgroundColor', ...accent);
both('components.primaryButton.{mode}.hover.textColor', ...bg);
both('components.primaryButton.{mode}.active.backgroundColor', ...accent);
both('components.primaryButton.{mode}.active.textColor', ...bg);

for (const btn of ['components.secondaryButton', 'components.idpButton.standard']) {
  both(`${btn}.{mode}.defaults.backgroundColor`, ...bg);
  both(`${btn}.{mode}.defaults.borderColor`, ...border);
  both(`${btn}.{mode}.defaults.textColor`, ...fg);
  for (const state of ['hover', 'active']) {
    both(`${btn}.{mode}.${state}.backgroundColor`, ...bg);
    both(`${btn}.{mode}.${state}.borderColor`, ...accent);
    both(`${btn}.{mode}.${state}.textColor`, ...accent);
  }
}

both('componentClasses.input.{mode}.defaults.backgroundColor', '131317ff', 'ffffffff');
both('componentClasses.input.{mode}.defaults.borderColor', ...border);
both('componentClasses.input.{mode}.placeholderColor', ...muted);
both('componentClasses.inputDescription.{mode}.textColor', ...muted);
both('componentClasses.inputLabel.{mode}.textColor', ...fg);
both('componentClasses.focusState.{mode}.borderColor', ...accent);
both('componentClasses.link.{mode}.defaults.textColor', ...accent);
both('componentClasses.link.{mode}.hover.textColor', ...fg);
both('componentClasses.divider.{mode}.borderColor', 'eceae529', '11111024');
both('componentClasses.optionControls.{mode}.defaults.backgroundColor', ...bg);
both('componentClasses.optionControls.{mode}.defaults.borderColor', ...border);
both('componentClasses.optionControls.{mode}.selected.backgroundColor', ...accent);
both('componentClasses.optionControls.{mode}.selected.foregroundColor', ...bg);
both('componentClasses.statusIndicator.{mode}.error.borderColor', 'e2574cff', 'a8362aff');
both('componentClasses.statusIndicator.{mode}.error.indicatorColor', 'e2574cff', 'a8362aff');

set('componentClasses.buttons.borderRadius', 0);
set('componentClasses.input.borderRadius', 0);
set('componentClasses.dropDown.borderRadius', 0);
set('components.form.borderRadius', 0);
set('components.alert.borderRadius', 0);

set('categories.global.colorSchemeMode', 'DARK');
set('categories.global.pageHeader.enabled', true);
set('categories.form.location.horizontal', 'START');
set('components.pageHeader.logo.enabled', true);
set('components.form.logo.enabled', true);
set('components.form.logo.location', 'START');
set('components.form.logo.formInclusion', 'IN');
set('components.favicon.enabledTypes', ['SVG']);

fs.writeFileSync(dest, JSON.stringify(s, null, 2) + '\n');
