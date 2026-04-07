package handlers

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type FileInfo struct {
	Name    string    `json:"name"`
	Size    int64     `json:"size"`
	IsDir   bool      `json:"isDir"`
	ModTime time.Time `json:"modTime"`
	Ext     string    `json:"ext"`
}

func ListWorkspaceFiles(c *gin.Context) {
	home, err := os.UserHomeDir()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "Cannot find home dir"})
		return
	}

	workspaceDir := filepath.Join(home, ".openclaw", "workspace-shared-experts")
	
	// Create if not exists
	if _, err := os.Stat(workspaceDir); os.IsNotExist(err) {
		_ = os.MkdirAll(workspaceDir, 0755)
	}

	relPath := c.Query("path")
	fullPath := filepath.Join(workspaceDir, relPath)

	// Security check: ensure path is within workspaceDir
	if !strings.HasPrefix(fullPath, workspaceDir) {
		c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": "Access denied"})
		return
	}

	entries, err := os.ReadDir(fullPath)
	if err != nil {
		log.Printf("Failed to read workspace dir %s: %v", fullPath, err)
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "Failed to read directory"})
		return
	}

	var files []FileInfo
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, FileInfo{
			Name:    entry.Name(),
			Size:    info.Size(),
			IsDir:   entry.IsDir(),
			ModTime: info.ModTime(),
			Ext:     filepath.Ext(entry.Name()),
		})
	}

	// Sort: dirs first, then name
	sort.Slice(files, func(i, j int) bool {
		if files[i].IsDir != files[j].IsDir {
			return files[i].IsDir
		}
		return strings.ToLower(files[i].Name) < strings.ToLower(files[j].Name)
	})

	c.JSON(http.StatusOK, gin.H{
		"ok":    true,
		"path":  relPath,
		"files": files,
	})
}
