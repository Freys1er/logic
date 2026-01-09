// This module exports the shared state and DOM element references for all other modules to use.
export const state = {
    editorCM: null,
    projectAssets: [],
    isPlaying: false,
    isRecording: false,
    animationId: null,
    currentFrame: 0,
    totalFrames: 300,
    currentBlobUrl: null,
    currentConfig: [],
    currentProjectName: null,
    currentCloudId: null,
    saveTimeout: null,
};

export const els = {
    frame: document.getElementById('preview-frame'),
    projectNameInput: document.getElementById('project-name-input'),
    publishBtn: document.getElementById('publish-btn'),
    form: document.getElementById('dynamic-form-container'),
    playBtn: document.getElementById('play-btn'),
    timeline: document.getElementById('timeline'),
    frameDisplay: document.getElementById('frame-display'),
    console: document.getElementById('console-output'),
    assetList: document.getElementById('asset-list'),
    toggleDev: document.getElementById('dev-mode-toggle'),
    panels: {
        settings: document.getElementById('panel-settings'),
        preview: document.getElementById('panel-preview'),
        assets: document.getElementById('panel-assets'),
        code: document.getElementById('panel-code'),
    },
    modals: { loading: document.getElementById('loading-overlay') },
};