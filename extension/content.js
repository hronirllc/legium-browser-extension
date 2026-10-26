//
// The extension's side of the notebook page. `notebook.js` is loaded first and
// does the work; this gives it a way to save a file, and lets the toolbar
// button bring back a panel that was closed.
//
// Files go to the background script rather than through a link on the page:
// it saves them with the downloads API, which can show the Save dialog when the
// reader asks for it, and it is where any other place to send them would be
// added.
//

(function () {
    'use strict';

    // The file rides inside the message rather than spread into it: it has a
    // `type` of its own, its MIME type, which would replace the message's.
    const exporter = globalThis.legiumExport.start({
        canAsk: true,
        save: async (file) => {
            const reply = await browser.runtime.sendMessage({ type: 'save', file });
            if (!reply || !reply.savedAs) throw new Error('the file was not saved');
            return reply;
        },
    });

    browser.runtime.onMessage.addListener((message) => {
        if (message && message.type === 'show-panel') {
            exporter.show();
            return Promise.resolve(true);
        }
        return undefined;
    });
})();
