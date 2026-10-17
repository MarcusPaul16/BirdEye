import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'portfolio' },
  { path: 'income', loadComponent: () => import('./income/income-page').then(m => m.IncomePage) },
  { path: 'portfolio', loadComponent: () => import('./portfolio/portfolio-page').then(m => m.PortfolioPage) },
  { path: 'valuations', loadComponent: () => import('./valuations/valuations-page').then(m => m.ValuationsPage) },
  { path: 'credits', loadComponent: () => import('./credits/credits-page').then(m => m.CreditsPage) },
  { path: 'companies', loadComponent: () => import('./companies/companies-page').then(m => m.CompaniesPage) },
];
