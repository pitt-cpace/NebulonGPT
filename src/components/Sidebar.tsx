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
  CheckBoxOutlineBlank as CheckBoxOutlineBlankIcon,
  Close as CloseIcon,
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
  onDeleteChat: (chatId: string) => void;
  onBulkDeleteChats?: (chatIds: string[]) => void;
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
  onBulkDeleteChats,
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
  
  // Group selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChats, setSelectedChats] = useState<Set<string>>(new Set());
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

  // Group selection handlers
  const handleToggleSelectionMode = () => {
    if (selectionMode) {
      // Exiting selection mode - clear selections
      setSelectedChats(new Set());
    }
    setSelectionMode(!selectionMode);
  };

  const handleToggleChatSelection = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelected = new Set(selectedChats);
    if (newSelected.has(chatId)) {
      newSelected.delete(chatId);
    } else {
      newSelected.add(chatId);
    }
    setSelectedChats(newSelected);
  };

  const handleSelectAll = () => {
    const allFilteredChatIds = filteredChats.map(chat => chat.id);
    setSelectedChats(new Set(allFilteredChatIds));
  };

  const handleDeselectAll = () => {
    setSelectedChats(new Set());
  };

  const handleBulkDelete = () => {
    // Delete all selected chats at once using bulk delete if available
    const chatIdsToDelete = Array.from(selectedChats);
    
    if (onBulkDeleteChats) {
      // Use bulk delete handler (deletes all at once in one state update)
      onBulkDeleteChats(chatIdsToDelete);
    } else {
      // Fallback to individual delete (may not work correctly for multiple chats)
      chatIdsToDelete.forEach(chatId => {
        onDeleteChat(chatId);
      });
    }
    
    setSelectedChats(new Set());
    setSelectionMode(false);
    setBulkDeleteConfirmOpen(false);
  };

  // Calculate selection state for "Select All" checkbox
  const allSelected = filteredChats.length > 0 && filteredChats.every(chat => selectedChats.has(chat.id));
  const someSelected = filteredChats.some(chat => selectedChats.has(chat.id));
  const indeterminate = someSelected && !allSelected;

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
        <ListItemButton onClick={handleToggleChats} sx={{ pr: 1 }}>
          <ListItemText primary="Chats" />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {/* Selection mode toggle */}
            <Tooltip title={selectionMode ? "Exit selection mode" : "Select multiple chats"}>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleSelectionMode();
                }}
                sx={{
                  color: selectionMode ? 'primary.main' : 'text.secondary',
                  backgroundColor: selectionMode ? 'action.selected' : 'transparent',
                  '&:hover': {
                    backgroundColor: 'action.hover',
                  },
                }}
              >
                {selectionMode ? <CloseIcon fontSize="small" /> : <CheckBoxOutlineBlankIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
            {chatsOpen ? <ExpandLess /> : <ExpandMore />}
          </Box>
        </ListItemButton>
        
        {/* Selection controls bar - shown when in selection mode */}
        {selectionMode && chatsOpen && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 2,
              py: 1,
              backgroundColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(144, 202, 249, 0.08)' : 'rgba(25, 118, 210, 0.08)',
              borderBottom: (theme) => `1px solid ${theme.palette.mode === 'dark' ? '#333' : '#e0e0e0'}`,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Checkbox
                size="small"
                checked={allSelected}
                indeterminate={indeterminate}
                onChange={() => {
                  if (allSelected) {
                    handleDeselectAll();
                  } else {
                    handleSelectAll();
                  }
                }}
                sx={{ p: 0.5 }}
              />
              <Typography variant="body2" color="text.secondary">
                {selectedChats.size > 0 
                  ? `${selectedChats.size} selected`
                  : 'Select all'
                }
              </Typography>
            </Box>
            {selectedChats.size > 0 && (
              <Tooltip title="Delete selected chats">
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => setBulkDeleteConfirmOpen(true)}
                  sx={{
                    '&:hover': {
                      backgroundColor: 'error.light',
                      color: 'error.contrastText',
                    },
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        )}
        
        <Collapse in={chatsOpen} timeout="auto" unmountOnExit>
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
                      onClick={() => {
                        if (selectionMode) {
                          // In selection mode, toggle selection
                          const newSelected = new Set(selectedChats);
                          if (newSelected.has(chat.id)) {
                            newSelected.delete(chat.id);
                          } else {
                            newSelected.add(chat.id);
                          }
                          setSelectedChats(newSelected);
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
                        ...(selectionMode && selectedChats.has(chat.id) && {
                          backgroundColor: (theme: any) => theme.palette.mode === 'dark' 
                            ? 'rgba(144, 202, 249, 0.16)' 
                            : 'rgba(25, 118, 210, 0.16)',
                        }),
                      }}
                    >
                      {/* Show checkbox in selection mode, otherwise show chat icon */}
                      {selectionMode ? (
                        <ListItemIcon sx={{ ...styles.chatListItemIcon, minWidth: 32 }}>
                          <Checkbox
                            size="small"
                            checked={selectedChats.has(chat.id)}
                            onClick={(e) => handleToggleChatSelection(chat.id, e)}
                            sx={{ p: 0 }}
                          />
                        </ListItemIcon>
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
                              sx={{ maxWidth: selectionMode ? '170px' : '150px' }}
                              onMouseEnter={(e) => handleMouseEnter(e, chat.title)}
                              onMouseMove={handleMouseMove}
                              onMouseLeave={handleMouseLeave}
                            >
                              {chat.title}
                            </Typography>
                          }
                        />
                      )}
                      {/* Only show edit/delete buttons when not in selection mode */}
                      {!selectionMode && (
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
                      )}
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
          Delete {selectedChats.size} Chat{selectedChats.size > 1 ? 's' : ''}?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="bulk-delete-dialog-description">
            Are you sure you want to delete {selectedChats.size} selected chat{selectedChats.size > 1 ? 's' : ''}? This action cannot be undone.
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
            autoFocus
          >
            Delete {selectedChats.size} Chat{selectedChats.size > 1 ? 's' : ''}
          </Button>
        </DialogActions>
      </Dialog>
    </Drawer>
  );
};

export default Sidebar;
