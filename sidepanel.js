const featureButtons = Array.from(document.querySelectorAll('[data-feature]'));
const featureSections = new Map([
  ['logger', document.getElementById('feature-logger')],
  ['session', document.getElementById('feature-session')],
  ['rules', document.getElementById('feature-rules')],
  ['payloads', document.getElementById('feature-payloads')],
  ['consent', document.getElementById('feature-consent')],
  ['network', document.getElementById('feature-network')],
]);

const setActiveFeature = (feature) => {
  featureButtons.forEach((button) => {
    const isActive = button.dataset.feature === feature;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
  featureSections.forEach((section, key) => {
    if (!section) {
      return;
    }
    section.classList.toggle('active', key === feature);
  });
};

featureButtons.forEach((button) => {
  if (button.disabled) {
    return;
  }
  button.addEventListener('click', () => {
    setActiveFeature(button.dataset.feature);
  });
});
