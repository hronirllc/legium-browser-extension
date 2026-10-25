//
// Saves what the notebook page exports, and answers the toolbar button.
//
// Every finished file comes through `deliver`. Today that means the downloads
// folder; a desktop app to send it to would be a second branch there.
//

'use strict';

const NOTEBOOK_URL = 'https://read.amazon.com/notebook';

/** Saves one file to the downloads folder. Resolves once it is written. */
async function download({ filename, type, data }) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    try {
        const id = await browser.downloads.download({ url, filename, conflictAction: 'uniquify' });
        await new Promise((resolve, reject) => {
            const listener = (delta) => {
                if (delta.id !== id || !delta.state) return;
                if (delta.state.current === 'complete') {
                    browser.downloads.onChanged.removeListener(listener);
                    resolve();
                } else if (delta.state.current === 'interrupted') {
                    browser.downloads.onChanged.removeListener(listener);
                    reject(new Error(`the download was interrupted (${delta.error ? delta.error.current : 'unknown'})`));
                }
            };
            browser.downloads.onChanged.addListener(listener);
        });
    } finally {
        URL.revokeObjectURL(url);
    }
}

function deliver(file) {
    return download(file);
}

browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'save') {
        return deliver(message.file).then(() => ({ saved: message.file.filename }));
    }
    return undefined;
});

// On a notebook page the button brings back the panel; anywhere else it opens
// the notebook. Asking the tab, rather than reading its address, needs no
// permission to see where the reader is browsing.
browser.action.onClicked.addListener(async (tab) => {
    try {
        await browser.tabs.sendMessage(tab.id, { type: 'show-panel' });
    } catch {
        await browser.tabs.create({ url: NOTEBOOK_URL });
    }
});
