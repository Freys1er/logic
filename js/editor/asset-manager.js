import { state, els } from './state.js';
import { updatePreview } from './preview-manager.js';

let dragStartIndex;

export function initAssetManager() {
    document.getElementById('add-asset-btn').addEventListener('click', () => {
        document.getElementById('asset-file-input').click();
    });
    document.getElementById('asset-file-input').addEventListener('change', handleAssetUpload);
    els.assetList.addEventListener('dragover', (e) => e.preventDefault());
    els.assetList.addEventListener('drop', handleDrop);
}

function handleAssetUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        state.projectAssets.push({ type: file.type, name: file.name, dataUrl: evt.target.result });
        renderAssetList();
        updatePreview();
    };
    reader.readAsDataURL(file);
}

export function renderAssetList() {
    els.assetList.innerHTML = '';
    state.projectAssets.forEach((asset, i) => {
        const div = document.createElement('div');
        div.className = 'asset-item';
        div.setAttribute('draggable', true);
        div.dataset.index = i;
        
        let thumb;
        if (asset.type.startsWith('image/')) {
            thumb = `<img src="${asset.dataUrl}" class="asset-thumb">`;
        } else if (asset.type.startsWith('audio/')) {
            thumb = `<span class="asset-thumb material-symbols-outlined">audio_file</span>`;
        } else {
            thumb = `<span class="asset-thumb material-symbols-outlined">movie</span>`;
        }

        div.innerHTML = `${thumb}<span class="asset-name">${asset.name}</span>
            <div class="asset-item-actions">
                <button class="btn-icon del-btn"><span class="material-symbols-outlined">delete</span></button>
            </div>`;
        
        div.querySelector('.del-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            state.projectAssets.splice(i, 1);
            renderAssetList();
            updatePreview();
        });

        div.addEventListener('dragstart', (e) => { dragStartIndex = i; div.classList.add('dragging'); });
        div.addEventListener('dragend', () => div.classList.remove('dragging'));
        els.assetList.appendChild(div);
    });
}

function handleDrop(e) {
    e.preventDefault();
    const dropTarget = e.target.closest('.asset-item');
    if (!dropTarget || dropTarget.dataset.index == dragStartIndex) return;
    
    const dropIndex = Number(dropTarget.dataset.index);
    const draggedItem = state.projectAssets.splice(dragStartIndex, 1)[0];
    state.projectAssets.splice(dropIndex, 0, draggedItem);
    
    renderAssetList();
    updatePreview();
}