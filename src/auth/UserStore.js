/**
 * @deprecated Use getDatabase().users — kept for backward compatibility.
 */
import { getDatabase } from '../database/index.js';

const users = () => getDatabase().users;

export const UserStore = {
  hasUser: () => users().hasUser(),
  getUser: () => users().getUser(),
  saveUser: (user) => users().saveUser(user),
  clearUser: () => users().clearUser(),
};
