import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Only for signed-in users; everyone else is sent to the sign-in page, which sends them back afterwards. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  return auth.email() ? true : inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** The sign-in page is pointless once signed in. */
export const guestGuard: CanActivateFn = () => (inject(AuthService).email() ? inject(Router).createUrlTree(['/portfolio']) : true);
