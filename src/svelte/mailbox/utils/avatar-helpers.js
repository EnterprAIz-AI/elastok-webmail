import {
  extractAddressList,
  displayAddresses,
  extractDisplayName,
} from '../../../utils/address.ts';

/**
 * Get display name from message's "from" field
 * @param {Object} message - Message object
 * @returns {string} Display name or email
 */
export const getFromDisplay = (message) => {
  if (!message) return '';
  const list = extractAddressList(message, 'from');
  const display = displayAddresses(list).join(', ');
  return display || message.from || message.From || '';
};

/**
 * Get display name from message's "to" field
 * @param {Object} message - Message object
 * @returns {string} Display name or email
 */
export const getToDisplay = (message) => {
  if (!message) return '';
  const list = extractAddressList(message, 'to');
  const display = displayAddresses(list).join(', ');
  return display || message.to || message.To || '';
};

/**
 * Find the most recent message in the conversation that has a non-empty
 * value for the given field, walking from newest → oldest.
 *
 * Guards against the common case where the latest message is a calendar
 * response / MDN / auto-reply with a missing `from`, which would otherwise
 * cause the entire conversation row to render as "(no sender)".
 */
const pickLatestWithField = (messages, field) => {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const altField = field === 'from' ? 'From' : field === 'to' ? 'To' : null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const value = m && (m[field] || (altField ? m[altField] : null));
    if (typeof value === 'string' ? value.trim() : value) return m;
  }
  return messages[messages.length - 1];
};

/**
 * Get display name from conversation's latest message
 * @param {Object} conv - Conversation object
 * @returns {string} Display name or email
 */
export const getConversationFromDisplay = (conv) => {
  if (!conv) return '';
  const target = Array.isArray(conv.messages) ? pickLatestWithField(conv.messages, 'from') : null;
  const display = getFromDisplay(target);
  return display || conv.latestFrom || conv.from || '';
};

/**
 * Get display name from conversation's latest message "to" field
 * @param {Object} conv - Conversation object
 * @returns {string} Display name or email
 */
export const getConversationToDisplay = (conv) => {
  if (!conv) return '';
  const target = Array.isArray(conv.messages) ? pickLatestWithField(conv.messages, 'to') : null;
  return getToDisplay(target);
};

/**
 * Get display name (no email) from conversation
 * @param {Object} conv - Conversation object
 * @returns {string} Display name only
 */
export const getConversationFromName = (conv) =>
  extractDisplayName(getConversationFromDisplay(conv));

/**
 * Get "To:" display name from conversation (for sent folder)
 * @param {Object} conv - Conversation object
 * @returns {string} Display name only
 */
export const getConversationToName = (conv) => extractDisplayName(getConversationToDisplay(conv));

/**
 * Get display name (no email) from message
 * @param {Object} msg - Message object
 * @returns {string} Display name only
 */
export const getMessageFromName = (msg) => extractDisplayName(getFromDisplay(msg));

/**
 * Get "To:" display name from message (for sent folder)
 * @param {Object} msg - Message object
 * @returns {string} Display name only
 */
export const getMessageToName = (msg) => extractDisplayName(getToDisplay(msg));

/**
 * Get initials from email sender
 * @param {string} from - From field (name or email)
 * @returns {string} Two-character initials
 */
export const getInitials = (from) => {
  if (!from) return '??';
  const displayName = extractDisplayName(from);
  // extractDisplayName now returns '' on empty/unparseable input; keep the
  // raw `from` string as a last-resort source so the avatar always shows
  // something letter-like instead of empty space.
  const source = displayName || (typeof from === 'string' ? from : '');
  if (!source) return '??';

  // If it's just an email, use first two letters
  if (source.includes('@')) {
    return source.substring(0, 2).toUpperCase();
  }

  // If it's a name, get initials from first and last name
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // Single word name - take first two letters
  return source.substring(0, 2).toUpperCase() || '??';
};

/**
 * Get initials from profile name
 * @param {string} name - Profile name
 * @returns {string} Two-character initials
 */
export const getProfileInitials = (name) => {
  const trimmed = (name || '').trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return trimmed.substring(0, 2).toUpperCase();
};

/**
 * Generate consistent avatar color based on sender email
 * @param {string} from - From field (email or name)
 * @returns {string} Hex color code
 */
export const getAvatarColor = (from) => {
  if (!from) return '#6b7280';

  const colors = [
    '#ef4444',
    '#f97316',
    '#f59e0b',
    '#84cc16',
    '#10b981',
    '#14b8a6',
    '#06b6d4',
    '#0ea5e9',
    '#3b82f6',
    '#6366f1',
    '#8b5cf6',
    '#a855f7',
    '#d946ef',
    '#ec4899',
    '#f43f5e',
  ];

  // Simple hash function for consistent color
  let hash = 0;
  for (let i = 0; i < from.length; i++) {
    hash = (hash << 5) - hash + from.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }

  return colors[Math.abs(hash) % colors.length];
};
