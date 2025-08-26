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
} from '@mui/material';
import {
  Add as AddIcon,
  Chat as ChatIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  ExpandLess,
  ExpandMore,
  Workspaces as WorkspacesIcon,
  AutoAwesome as AutoAwesomeIcon,
} from '@mui/icons-material';
import { ChatType } from '../types';
import * as styles from '../styles/components/Sidebar.styles';

interface SidebarProps {
  open: boolean;
  chats: ChatType[];
  currentChatId?: string;
  onCreateNewChat: () => void;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onUpdateChatTitle: (chatId: string, newTitle: string) => void;
  onLoadMoreChats?: () => void;
  hasMoreChats?: boolean;
  isLoadingChats?: boolean;
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
}) => {
  const [chatsOpen, setChatsOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingChatTitle, setEditingChatTitle] = useState('');
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipContent, setTooltipContent] = useState('');
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [tooltipTimeout, setTooltipTimeout] = useState<NodeJS.Timeout | null>(null);
  
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
  };

  const handleSaveTitle = (chatId: string) => {
    if (editingChatTitle.trim()) {
      onUpdateChatTitle(chatId, editingChatTitle.trim());
    }
    setEditingChatId(null);
  };

  const handleTitleKeyDown = (chatId: string, e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveTitle(chatId);
    } else if (e.key === 'Escape') {
      setEditingChatId(null);
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

  return (
    <Drawer
      variant="persistent"
      anchor="left"
      open={open}
      sx={styles.drawer}
    >
      <Box sx={styles.contentContainer}>
        {/* Logo and App Name */}
        <Box sx={styles.logoContainer}>
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
                src="/cpace-logo.png" 
                alt="CPACE Logo" 
                sx={styles.cpaceLogo} 
              />
            </Box>
          </Box>
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
                      selected={chat.id === currentChatId}
                      onClick={() => onSelectChat(chat.id)}
                      sx={styles.chatListItem}
                    >
                      <ListItemIcon sx={styles.chatListItemIcon}>
                        <ChatIcon fontSize="small" />
                      </ListItemIcon>
                      {editingChatId === chat.id ? (
                        <TextField
                          size="small"
                          value={editingChatTitle}
                          onChange={(e) => setEditingChatTitle(e.target.value)}
                          onKeyDown={(e) => handleTitleKeyDown(chat.id, e)}
                          onBlur={() => handleSaveTitle(chat.id)}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          sx={styles.editTextField}
                        />
                      ) : (
                        <ListItemText 
                          primary={
                            <Typography
                              noWrap
                              sx={{ maxWidth: '150px', cursor: 'pointer' }}
                              onMouseEnter={(e) => handleMouseEnter(e, chat.title)}
                              onMouseMove={handleMouseMove}
                              onMouseLeave={handleMouseLeave}
                              onClick={(e) => {
                                if (chat.title === 'New Chat') {
                                  handleStartEditing(chat.id, chat.title, e);
                                }
                              }}
                              onDoubleClick={(e) => handleStartEditing(chat.id, chat.title, e)}
                            >
                              {chat.title}
                            </Typography>
                          }
                        />
                      )}
                      <Box sx={{ display: 'flex' }}>
                        {!editingChatId && (
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteChat(chat.id);
                            }}
                            sx={styles.deleteButton}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
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
    </Drawer>
  );
};

export default Sidebar;
