import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  IconButton,
  Typography,
  Collapse,
  TextField,
  InputAdornment,
  Tooltip,
  Avatar,
  Button,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Checkbox,
} from '@mui/material';
import {
  Add as AddIcon,
  Chat as ChatIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Search as SearchIcon,
  ExpandLess,
  ExpandMore,
  Workspaces as WorkspacesIcon,
  AutoAwesome as AutoAwesomeIcon,
  ChevronLeft as ChevronLeftIcon,
  DeleteSweep as DeleteSweepIcon,
} from '@mui/icons-material';
import { ChatType } from '../types';
import * as styles from '../styles/components/Sidebar.styles';
import { RO } from '../hooks/ResizeObserverManager';

interface SidebarProps {
  open: boolean;
  chats: ChatType[];
  currentChatId?: string;
  onCreateNewChat: () => void;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string | string[]) => void;
  onUpdateChatTitle: (chatId: string, newTitle: string) => void;
  onLoadMoreChats?: () => void;
  hasMoreChats?: boolean;
  isLoadingChats?: boolean;
  onClose?: () => void;
  onEditingStateChange?: (isEditing: boolean) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  open,
  chats,
  currentChatId,
  onCreateNewChat,
  onSelectChat,
  onDeleteChat,
  onUpdateChatTitle,
  onLoadMoreChats,
  hasMoreChats = false,
  isLoadingChats = false,
  onClose,
  onEditingStateChange,
}) => {
  const [chatsOpen, setChatsOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingChatTitle, setEditingChatTitle] = useState('');
  const editTextFieldRef = useRef<HTMLInputElement>(null);
  const pendingChatSelectionRef = useRef<string | null>(null);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipContent, setTooltipContent] = useState('');
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [tooltipTimeout, setTooltipTimeout] = useState<NodeJS.Timeout | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [chatToDelete, setChatToDelete] = useState<{ id: string; title: string } | null>(null);
  
  // Selection mode state for bulk delete
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  
  // Refs for scroll detection
  const chatListRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef<HTMLLIElement>(null);

  const handleToggleChats = () => {
    setChatsOpen(!chatsOpen);
  };

  const handleStartEditing = (chatId: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(chatId);
    setEditingChatTitle(currentTitle);
    // Notify parent that editing has started
    if (onEditingStateChange) {
      onEditingStateChange(true);
    }
  };

  const handleSaveTitle = (chatId: string) => {
    if (editingChatTitle.trim()) {
      onUpdateChatTitle(chatId, editingChatTitle.trim());
    }
    setEditingChatId(null);
    // Notify parent that editing has ended
    if (onEditingStateChange) {
      onEditingStateChange(false);
    }
    
    // If there's a pending chat selection, execute it after a small delay
    if (pendingChatSelectionRef.current) {
      const chatId = pendingChatSelectionRef.current;
      pendingChatSelectionRef.current = null;
      setTimeout(() => onSelectChat(chatId), 100);
    }
  };

  const handleTitleKeyDown = (chatId: string, e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveTitle(chatId);
    } else if (e.key === 'Escape') {
      setEditingChatId(null);
      // Notify parent that editing has ended (cancelled)
      if (onEditingStateChange) {
        onEditingStateChange(false);
      }
    }
  };

  const handleMouseEnter = (e: React.MouseEvent, title: string) => {
    // Clear any existing timeout
    if (tooltipTimeout) {
      clearTimeout(tooltipTimeout);
    }
    
    setMousePosition({ 
      x: e.clientX, 
      y: e.clientY 
    });
    setTooltipContent(title);
    
    // Set tooltip to show after 2 seconds
    const timeout = setTimeout(() => {
      setTooltipOpen(true);
    }, 1000);
    
    setTooltipTimeout(timeout);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePosition({ 
      x: e.clientX, 
      y: e.clientY 
    });
  };

  const handleMouseLeave = () => {
    // Clear timeout if mouse leaves before 2 seconds
    if (tooltipTimeout) {
      clearTimeout(tooltipTimeout);
      setTooltipTimeout(null);
    }
    setTooltipOpen(false);
  };

  // Selection handlers for bulk delete
  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    setSelectedChatIds(new Set());
  };

  const toggleChatSelection = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelected = new Set(selectedChatIds);
    if (newSelected.has(chatId)) {
      newSelected.delete(chatId);
    } else {
      newSelected.add(chatId);
    }
    setSelectedChatIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedChatIds.size === filteredChats.length) {
      // Deselect all
      setSelectedChatIds(new Set());
    } else {
      // Select all
      const allIds = new Set(filteredChats.map(chat => chat.id));
      setSelectedChatIds(allIds);
    }
  };

  const handleBulkDelete = () => {
    // Convert Set to Array
    const idsToDelete = Array.from(selectedChatIds);
    
    // Pass the entire array to onDeleteChat (App.tsx now supports arrays)
    // This prevents race conditions from multiple state updates
    onDeleteChat(idsToDelete);
    
    // Clear selection immediately
    setSelectedChatIds(new Set());
    setSelectionMode(false);
    setBulkDeleteConfirmOpen(false);
  };

  // Scroll detection for lazy loading
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const isNearBottom = scrollTop + clientHeight >= scrollHeight - 100; // Load when 100px from bottom
    
    if (isNearBottom && hasMoreChats && !isLoadingChats && onLoadMoreChats) {
      onLoadMoreChats();
    }
  }, [hasMoreChats, isLoadingChats, onLoadMoreChats]);

  // Intersection Observer for loading indicator
  useEffect(() => {
    if (!loadingRef.current || !hasMoreChats || !onLoadMoreChats) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && !isLoadingChats) {
          onLoadMoreChats();
        }
      },
      {
        threshold: 0.1,
        rootMargin: '50px',
      }
    );

    observer.observe(loadingRef.current);

    return () => {
      observer.disconnect();
    };
  }, [hasMoreChats, isLoadingChats, onLoadMoreChats]);

  const filteredChats = chats.filter(chat =>
    chat.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Drawer
      variant="persistent"
      anchor="left"
      open={open}
      sx={styles.drawer}
    >
      <Box sx={styles.contentContainer}>
        {/* Logo and App Name with Close button */}
        <Box sx={{ ...styles.logoContainer, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar sx={styles.logoAvatar}>
              <AutoAwesomeIcon />
            </Avatar>
            <Box>
              <Typography variant="h6" component="div" sx={styles.appTitle}>
                Nebulon-GPT
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Your Private AI Assistant
              </Typography>
              <Box sx={styles.byLogoContainer}>
                <Typography variant="caption" color="text.secondary" sx={styles.byText}>
                  BY
                </Typography>
                <Box component="img" 
                  src="./cpace-logo.png" 
                  alt="CPACE Logo" 
                  sx={styles.cpaceLogo} 
                />
              </Box>
            </Box>
          </Box>
          
          {/* Close button - inline with title */}
          {onClose && (
            <Tooltip title="Close sidebar">
              <IconButton
                onClick={() => {
                  // If editing, blur the TextField first, then close after delay
                  if (editingChatId && editTextFieldRef.current) {
                    editTextFieldRef.current.blur();
                    // Suspend for longer to cover TextField unmount + close animation
                    RO.suspendFor(600);
                    // Wait for blur event to complete before closing
                    setTimeout(() => onClose(), 200);
                  } else {
                    // Not editing, close normally
                    RO.suspendFor(400);
                    onClose();
                  }
                }}
                size="small"
                sx={{
                  color: 'text.secondary',
                  mt: 0.5,
                  '&:hover': {
                    color: 'primary.main',
                    backgroundColor: 'action.hover',
                  },
                }}
              >
                <ChevronLeftIcon />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        
        {/* New Chat Button */}
        <Box sx={styles.newChatButtonContainer}>
          <Tooltip title="Create a new chat">
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={onCreateNewChat}
              fullWidth
              sx={styles.newChatButton}
            >
              New Chat
            </Button>
          </Tooltip>
        </Box>
      </Box>

      <Divider sx={styles.divider} />

      <List>
        <ListItem disablePadding>
          <ListItemButton>
            <ListItemIcon>
              <WorkspacesIcon />
            </ListItemIcon>
            <ListItemText primary="Workspace" />
          </ListItemButton>
        </ListItem>
      </List>

      <Box sx={styles.searchContainer}>
        <TextField
          fullWidth
          placeholder="Search"
          size="small"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={styles.searchField}
        />
      </Box>

      <List>
        <ListItemButton onClick={handleToggleChats}>
          <ListItemText primary="Chats" />
          {chatsOpen ? <ExpandLess /> : <ExpandMore />}
        </ListItemButton>
        <Collapse in={chatsOpen} timeout="auto" unmountOnExit>
          {/* Selection Mode Header - Select All and Bulk Delete */}
          {filteredChats.length > 0 && (
            <Box sx={{ 
              px: 2, 
              py: 1, 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              backgroundColor: selectionMode ? 'rgba(244, 67, 54, 0.08)' : 'transparent',
              borderBottom: selectionMode ? '1px solid' : 'none',
              borderColor: 'divider',
              transition: 'all 0.2s',
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Checkbox
                  size="small"
                  checked={selectedChatIds.size === filteredChats.length && filteredChats.length > 0}
                  indeterminate={selectedChatIds.size > 0 && selectedChatIds.size < filteredChats.length}
                  onChange={toggleSelectAll}
                  sx={{
                    padding: '4px',
                    '&.Mui-checked': {
                      color: 'error.main',
                    },
                    '&.MuiCheckbox-indeterminate': {
                      color: 'error.main',
                    },
                  }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                  {selectionMode && selectedChatIds.size > 0 
                    ? `${selectedChatIds.size} selected`
                    : 'Select All'
                  }
                </Typography>
              </Box>
              
              {selectedChatIds.size > 0 && (
                <Tooltip title="Delete selected chats">
                  <IconButton
                    size="small"
                    onClick={() => setBulkDeleteConfirmOpen(true)}
                    sx={{
                      color: 'error.main',
                      '&:hover': {
                        backgroundColor: 'rgba(244, 67, 54, 0.12)',
                      },
                    }}
                  >
                    <DeleteSweepIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )}
          <Box
            ref={chatListRef}
            onScroll={handleScroll}
            sx={{
              maxHeight: 'calc(100vh - 400px)', // Adjust based on your layout
              overflowY: 'auto',
              overflowX: 'hidden',
            }}
          >
            <List component="div" disablePadding>
              {filteredChats.length > 0 ? (
                <>
                  {filteredChats.map((chat) => (
                    <ListItemButton
                      key={chat.id}
                      selected={!selectionMode && chat.id === currentChatId}
                      onClick={(e) => {
                        // In selection mode, clicking toggles selection
                        if (selectionMode || selectedChatIds.size > 0) {
                          toggleChatSelection(chat.id, e);
                        } else {
                          // If currently editing, queue the selection after save
                          if (editingChatId) {
                            pendingChatSelectionRef.current = chat.id;
                            editTextFieldRef.current?.blur();
                          } else {
                            onSelectChat(chat.id);
                          }
                        }
                      }}
                      sx={{
                        ...styles.chatListItem,
                        backgroundColor: selectedChatIds.has(chat.id) 
                          ? 'rgba(244, 67, 54, 0.12)' 
                          : undefined,
                      }}
                    >
                      {selectedChatIds.size > 0 ? (
                        <Checkbox
                          size="small"
                          checked={selectedChatIds.has(chat.id)}
                          onClick={(e) => toggleChatSelection(chat.id, e)}
                          sx={{
                            padding: '4px',
                            mr: 1,
                            '&.Mui-checked': {
                              color: 'error.main',
                            },
                          }}
                        />
                      ) : (
                        <ListItemIcon sx={styles.chatListItemIcon}>
                          <ChatIcon fontSize="small" />
                        </ListItemIcon>
                      )}
                      {editingChatId === chat.id ? (
                        <TextField
                          size="small"
                          value={editingChatTitle}
                          onChange={(e) => setEditingChatTitle(e.target.value)}
                          onKeyDown={(e) => handleTitleKeyDown(chat.id, e)}
                          onBlur={() => handleSaveTitle(chat.id)}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          inputRef={editTextFieldRef}
                          sx={styles.editTextField}
                        />
                      ) : (
                        <ListItemText 
                          primary={
                            <Typography
                              noWrap
                              sx={{ maxWidth: '150px' }}
                              onMouseEnter={(e) => handleMouseEnter(e, chat.title)}
                              onMouseMove={handleMouseMove}
                              onMouseLeave={handleMouseLeave}
                            >
                              {chat.title}
                            </Typography>
                          }
                        />
                      )}
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {editingChatId !== chat.id && (
                          <>
                            <IconButton
                              size="small"
                              onClick={(e) => handleStartEditing(chat.id, chat.title, e)}
                              sx={styles.editButton}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                setChatToDelete({ id: chat.id, title: chat.title });
                                setDeleteConfirmOpen(true);
                              }}
                              sx={styles.deleteButton}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </>
                        )}
                      </Box>
                    </ListItemButton>
                  ))}
                  
                  {/* Loading indicator */}
                  {hasMoreChats && (
                    <ListItem
                      ref={loadingRef}
                      sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        py: 2,
                      }}
                    >
                      {isLoadingChats ? (
                        <CircularProgress size={20} />
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          Scroll to load more...
                        </Typography>
                      )}
                    </ListItem>
                  )}
                </>
              ) : (
                <ListItem sx={styles.noChatFound}>
                  <ListItemText 
                    primary="No chats found" 
                    primaryTypographyProps={{ 
                      variant: 'body2',
                      color: 'text.secondary',
                    }} 
                  />
                </ListItem>
              )}
            </List>
          </Box>
        </Collapse>
      </List>
      
      {/* Custom Tooltip */}
      {tooltipOpen && (
        <Box
          sx={{
            position: 'fixed',
            left: mousePosition.x + 10,
            top: mousePosition.y + 30,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            pointerEvents: 'none',
            zIndex: 9999,
            maxWidth: '200px',
            wordWrap: 'break-word',
            whiteSpace: 'normal',
          }}
        >
          {tooltipContent}
        </Box>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <DialogTitle id="delete-dialog-title">
          Delete Chat?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-dialog-description">
            Are you sure you want to delete "{chatToDelete?.title}"? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => {
              setDeleteConfirmOpen(false);
              setChatToDelete(null);
            }}
            color="primary"
          >
            Cancel
          </Button>
          <Button 
            onClick={() => {
              if (chatToDelete) {
                onDeleteChat(chatToDelete.id);
              }
              setDeleteConfirmOpen(false);
              setChatToDelete(null);
            }}
            color="error"
            variant="contained"
            autoFocus
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog
        open={bulkDeleteConfirmOpen}
        onClose={() => setBulkDeleteConfirmOpen(false)}
        aria-labelledby="bulk-delete-dialog-title"
        aria-describedby="bulk-delete-dialog-description"
      >
        <DialogTitle id="bulk-delete-dialog-title">
          Delete Selected Chats?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="bulk-delete-dialog-description">
            Are you sure you want to delete {selectedChatIds.size} selected chat{selectedChatIds.size !== 1 ? 's' : ''}? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => setBulkDeleteConfirmOpen(false)}
            color="primary"
          >
            Cancel
          </Button>
          <Button 
            onClick={handleBulkDelete}
            color="error"
            variant="contained"
            startIcon={<DeleteSweepIcon />}
            autoFocus
          >
            Delete {selectedChatIds.size} Chat{selectedChatIds.size !== 1 ? 's' : ''}
          </Button>
        </DialogActions>
      </Dialog>
    </Drawer>
  );
};

export default Sidebar;
