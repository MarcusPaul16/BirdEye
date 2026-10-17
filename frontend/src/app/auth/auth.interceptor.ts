import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * Adds the header the API requires on every call (a cross-site page cannot add it, which is what stops forged requests), and sends the
 * user to the sign-in page when the session has ended.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const isApi = req.url.startsWith('/api');
  const request = isApi ? req.clone({ setHeaders: { 'X-Requested-With': 'BirdEye' } }) : req;

  return next(request).pipe(
    catchError(err => {
      // A wrong password on the sign-in form is also a 401, but that is for the form to show, not a reason to leave the page.
      if (isApi && err.status === 401 && !req.url.startsWith('/api/auth/')) auth.expired();
      return throwError(() => err);
    }),
  );
};
