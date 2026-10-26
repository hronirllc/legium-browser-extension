//
// Saves what the notebook page exports, and answers the toolbar button.
//
// Every finished file comes through `deliver`. Today that means the downloads
// folder; a desktop app to send it to would be a second branch there.
//

'use strict';

const NOTEBOOK_URL = 'https://read.amazon.com/notebook';

/**
 * Saves one file: to the downloads folder, or wherever the reader picks in the
 * Save dialog when `ask` is set. Resolves to the path it was written to.
 */
async function download({ filename, type, data, ask }) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    try {
        const id = await browser.downloads.download({
            url, filename, saveAs: Boolean(ask), conflictAction: 'uniquify',
        });
        // Listening first and then asking, because a small file can finish
        // before a listener added afterwards would hear about it.
        await new Promise((resolve, reject) => {
            const settle = (state, error) => {
                if (state === 'complete') {
                    browser.downloads.onChanged.removeListener(listener);
                    resolve();
                } else if (state === 'interrupted') {
                    browser.downloads.onChanged.removeListener(listener);
                    reject(new Error(`the download was interrupted (${error || 'unknown'})`));
                }
            };
            const listener = (delta) => {
                if (delta.id === id && delta.state) settle(delta.state.current, delta.error && delta.error.current);
            };
            browser.downloads.onChanged.addListener(listener);
            browser.downloads.search({ id }).then(([item]) => item && settle(item.state, item.error));
        });
        const [item] = await browser.downloads.search({ id });
        return item ? item.filename : filename;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function deliver(file) {
    return download(file);
}

browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'save') {
        return deliver(message.file).then((savedAs) => ({ savedAs }));
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
