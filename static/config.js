'use strict';

const config = {
  callbacks: [], // will be called when prefs are ready,
  onChanged: []
};
window.config = config;
config.prefs = {
  'font-size': 13,
  'font': 'sans-serif',
  'width': 600,
  'line-height': 0,
  'new-tab': true,
  'reader-mode': false,
  'faqs': true,
  'version': null,
  'mode': localStorage.getItem('mode') || 'sepia',
  'printing-button': localStorage.getItem('printing-button') !== 'false',
  'save-button': localStorage.getItem('save-button') !== 'false',
  'fullscreen-button': localStorage.getItem('fullscreen-button') !== 'false',
  'speech-button': localStorage.getItem('speech-button') !== 'false',
  'images-button': localStorage.getItem('images-button') !== 'false',
  'show-images': localStorage.getItem('show-images') !== 'false',
  'navigate-buttons': localStorage.getItem('navigate-buttons') !== 'false',
  'top-css': localStorage.getItem('top-css') || '',
  'user-css': localStorage.getItem('user-css') || `body {
  padding-bottom: 64px;
}
a:visited {
  color: #d33bf0;
}
a:link, a:link:hover, a:link:active {
  color: #0095dd;
}
a:link {
  text-decoration: none;
  font-weight: normal;
}
pre {
  white-space: pre-wrap;
}
pre code {
  background-color: #eff0f1;
  color: #393318;
  font-family: monospace;
  display: block;
  padding: 5px 10px;
}
body[data-mode="dark"] pre code {
  background-color: #585858;
  color: #e8e8e8;
}

/* CSS for sans-serif fonts */
body[data-font=sans-serif] {}
/* CSS for serif fonts */
body[data-font=serif] {}

/* CSS for "sepia" theme */
body[data-mode=sepia] {
}
/* CSS for "light" theme */
body[data-mode=light] {}
/* CSS for "dark" theme */
body[data-mode=dark] {}`,
  'context-open-in-reader-view': false,
  'context-open-in-reader-view-bg': false,
  'context-switch-to-reader-view': true
};

config.load = c => {
  if (config.ready) {
    c();
  }
  else {
    config.callbacks.push(c);
  }
};
