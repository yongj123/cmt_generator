// Add collapsible functionality to folders
document.addEventListener('DOMContentLoaded', function() {
    // Make folders collapsible
    document.querySelectorAll('.folder-name').forEach(folderName => {
        folderName.addEventListener('click', function() {
            const folderItem = this.parentElement;
            const folderContent = folderItem.querySelector('.tree-list');
            
            if (folderContent) {
                folderContent.style.display = 
                    folderContent.style.display === 'none' ? 'block' : 'none';
                
                // Change folder icon
                const folderIcon = this.querySelector('.bi');
                if (folderIcon) {
                    if (folderContent.style.display === 'none') {
                        folderIcon.classList.remove('bi-folder-fill');
                        folderIcon.classList.add('bi-folder');
                    } else {
                        folderIcon.classList.remove('bi-folder');
                        folderIcon.classList.add('bi-folder-fill');
                    }
                }
            }
        });
    });
}); 