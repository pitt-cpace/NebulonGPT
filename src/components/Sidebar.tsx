import React, { useState } from 'react';
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

interface SidebarProps {
  open: boolean;
  chats: ChatType[];
  currentChatId?: string;
  onCreateNewChat: () => void;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onUpdateChatTitle: (chatId: string, newTitle: string) => void;
}

const drawerWidth = 280;

const Sidebar: React.FC<SidebarProps> = ({
  open,
  chats,
  currentChatId,
  onCreateNewChat,
  onSelectChat,
  onDeleteChat,
  onUpdateChatTitle,
}) => {
  const [chatsOpen, setChatsOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingChatTitle, setEditingChatTitle] = useState('');

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

  const filteredChats = chats.filter(chat =>
    chat.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Drawer
      variant="persistent"
      anchor="left"
      open={open}
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
          backgroundColor: '#121212',
          borderRight: '1px solid #333',
        },
      }}
    >
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Logo and App Name */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Avatar
            sx={{ 
              bgcolor: 'rgba(144, 202, 249, 0.2)',
              color: '#90caf9',
              width: 40,
              height: 40,
            }}
          >
            <AutoAwesomeIcon />
          </Avatar>
          <Box>
            <Typography variant="h6" component="div" sx={{ lineHeight: 1.2 }}>
              Nebulon-GPT
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Your Private AI Assistant
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              by HH Rashidi
            </Typography>
          </Box>
        </Box>
        
        {/* New Chat Button */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title="Create a new chat">
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={onCreateNewChat}
              fullWidth
              sx={{ 
                backgroundColor: 'rgba(144, 202, 249, 0.1)',
                color: '#90caf9',
                textTransform: 'none',
                justifyContent: 'flex-start',
                '&:hover': {
                  backgroundColor: 'rgba(144, 202, 249, 0.2)',
                },
                borderRadius: 2,
                py: 1,
              }}
            >
              New Chat
            </Button>
          </Tooltip>
        </Box>
      </Box>

      <Divider sx={{ borderColor: '#333' }} />

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

      <Box sx={{ px: 2, py: 1 }}>
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
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: 2,
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: 'rgba(255, 255, 255, 0.1)',
              },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderColor: 'primary.main',
              },
            },
          }}
        />
      </Box>

      <List>
        <ListItemButton onClick={handleToggleChats}>
          <ListItemText primary="Chats" />
          {chatsOpen ? <ExpandLess /> : <ExpandMore />}
        </ListItemButton>
        <Collapse in={chatsOpen} timeout="auto" unmountOnExit>
          <List component="div" disablePadding>
            {filteredChats.length > 0 ? (
              filteredChats.map((chat) => (
                <ListItemButton
                  key={chat.id}
                  selected={chat.id === currentChatId}
                  onClick={() => onSelectChat(chat.id)}
                  sx={{
                    pl: 4,
                    '&.Mui-selected': {
                      backgroundColor: 'rgba(144, 202, 249, 0.08)',
                    },
                    '&.Mui-selected:hover': {
                      backgroundColor: 'rgba(144, 202, 249, 0.12)',
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
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
                      sx={{ 
                        flex: 1,
                        mr: 1,
                        '& .MuiOutlinedInput-root': {
                          borderRadius: 1,
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        }
                      }}
                    />
                  ) : (
                    <ListItemText 
                      primary={chat.title} 
                      primaryTypographyProps={{
                        noWrap: true,
                        sx: { maxWidth: '150px' }
                      }}
                      onClick={(e) => {
                        if (chat.title === 'New Chat') {
                          handleStartEditing(chat.id, chat.title, e);
                        }
                      }}
                      onDoubleClick={(e) => handleStartEditing(chat.id, chat.title, e)}
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
                        sx={{ 
                          opacity: 0,
                          transition: 'opacity 0.2s',
                          '&:hover': { opacity: 1 },
                          '.MuiListItemButton-root:hover &': { opacity: 0.7 },
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Box>
                </ListItemButton>
              ))
            ) : (
              <ListItem sx={{ pl: 4 }}>
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
        </Collapse>
      </List>
    </Drawer>
  );
};

export default Sidebar;
