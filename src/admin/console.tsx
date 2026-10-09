import { createContext, useContext } from 'react';

/**
 * Who is using the shared editors (VenueEditor, EventEditor, EventsList…):
 * the admin console at /admin, or a venue manager at /manage, who sees only
 * their own venues and none of the admin-only controls (publish, featured,
 * slug, activity radius, delete, managers). The database enforces the same
 * limits; this just keeps the UI honest.
 */
export interface ConsoleScope {
  role: 'admin' | 'manager';
  /** Route prefix for links inside the console. */
  base: '/admin' | '/manage';
  /** Venues a manager may edit (null for admins: all of them). */
  venueIds: string[] | null;
  /** A manager's venue page lives at /manage/v/:id; the admin's at /admin/v/:id. */
  venuePath: (id: string) => string;
}

export const ADMIN_SCOPE: ConsoleScope = { role: 'admin', base: '/admin', venueIds: null, venuePath: (id) => `/admin/v/${id}` };

const ConsoleContext = createContext<ConsoleScope>(ADMIN_SCOPE);

export const ConsoleProvider = ConsoleContext.Provider;
export const useConsole = () => useContext(ConsoleContext);
