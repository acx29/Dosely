// Settings shared by browser code and server routes. No secrets here: this file ships to the browser.

/** How many patients at the clinic one recall run contacts. The rest stay queued for later runs. */
export const RECALL_BATCH_SIZE = 25;
