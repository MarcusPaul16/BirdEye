import { Route, Routes } from '@angular/router';
import { authGuard, guestGuard } from './auth/auth.guards';

const guarded = (route: Route): Route => ({ ...route, canActivate: [authGuard] });

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'portfolio' },
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./auth/login-page').then(m => m.LoginPage) },
  guarded({ path: 'account', loadComponent: () => import('./auth/account-page').then(m => m.AccountPage) }),
  guarded({ path: 'income', loadComponent: () => import('./income/income-page').then(m => m.IncomePage) }),
  guarded({ path: 'portfolio', loadComponent: () => import('./portfolio/portfolio-page').then(m => m.PortfolioPage) }),
  guarded({ path: 'expenses', loadComponent: () => import('./expenses/expenses-page').then(m => m.ExpensesPage) }),
  guarded({ path: 'calendar', loadComponent: () => import('./calendar/calendar-page').then(m => m.CalendarPage) }),
  guarded({ path: 'valuations', loadComponent: () => import('./valuations/valuations-page').then(m => m.ValuationsPage) }),
  guarded({ path: 'credits', loadComponent: () => import('./credits/credits-page').then(m => m.CreditsPage) }),
  guarded({ path: 'companies', loadComponent: () => import('./companies/companies-page').then(m => m.CompaniesPage) }),
  { path: '**', redirectTo: 'portfolio' },
];
