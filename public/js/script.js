// Add collapsible functionality to folders
document.addEventListener('DOMContentLoaded', function() {
    // Make folders collapsible
    document.querySelectorAll('.folder-name').forEach(folderName => {
        folderName.addEventListener('click', function() {
            // 由于我们修改了HTML结构，需要调整父元素的查找方式
            // 现在folder-name在div内部，而div是tree-folder的子元素
            const folderItem = this.closest('.tree-folder');
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