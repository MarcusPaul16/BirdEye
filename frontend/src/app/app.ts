import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ThemeService } from './core/theme';
import { AuthService } from './auth/auth.service';
import { Motivate } from './shared/motivate';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Motivate],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly theme = inject(ThemeService);
  protected readonly auth = inject(AuthService);
}
