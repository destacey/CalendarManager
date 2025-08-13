import { PublicClientApplication, Configuration, AccountInfo, SilentRequest, RedirectRequest } from '@azure/msal-browser';
import { Client } from '@microsoft/microsoft-graph-client';

export interface AuthConfig {
  clientId: string;
}

class AuthService {
  private msalInstance: PublicClientApplication | null = null;
  private graphClient: Client | null = null;

  async initialize(clientId: string): Promise<void> {
    if (!clientId || clientId.trim() === '') {
      throw new Error('Client ID is required for initialization');
    }

    const msalConfig: Configuration = {
      auth: {
        clientId: clientId.trim(),
        authority: 'https://login.microsoftonline.com/organizations',
        redirectUri: window.location.origin,
      },
      cache: {
        cacheLocation: 'localStorage',
        storeAuthStateInCookie: false,
      },
    };

    this.msalInstance = new PublicClientApplication(msalConfig);
    await this.msalInstance.initialize();
  }

  async handleRedirectPromise(): Promise<void> {
    if (!this.msalInstance) {
      throw new Error('MSAL instance not initialized');
    }

    try {
      const response = await this.msalInstance.handleRedirectPromise();
      if (response && response.account) {
        this.msalInstance.setActiveAccount(response.account);
      }
    } catch (error) {
      console.warn('Redirect handling failed:', error);
      throw error;
    }
  }

  async login(): Promise<void> {
    if (!this.msalInstance) {
      throw new Error('MSAL instance not initialized');
    }

    const loginRequest: RedirectRequest = {
      scopes: ['User.Read', 'Calendars.Read', 'Calendars.ReadWrite'],
      prompt: 'select_account',
    };

    try {
      await this.msalInstance.loginRedirect(loginRequest);
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  async logout(): Promise<void> {
    if (!this.msalInstance) {
      throw new Error('MSAL instance not initialized');
    }

    try {
      await this.msalInstance.logoutRedirect();
      this.graphClient = null;
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    }
  }

  async getAccessToken(): Promise<string> {
    if (!this.msalInstance) {
      throw new Error('MSAL instance not initialized');
    }

    const activeAccount = this.msalInstance.getActiveAccount();
    if (!activeAccount) {
      throw new Error('No active account found');
    }

    const silentRequest: SilentRequest = {
      scopes: ['User.Read', 'Calendars.Read', 'Calendars.ReadWrite'],
      account: activeAccount,
    };

    try {
      const response = await this.msalInstance.acquireTokenSilent(silentRequest);
      return response.accessToken;
    } catch (error) {
      console.error('Silent token acquisition failed:', error);
      throw error;
    }
  }

  getCurrentAccount(): AccountInfo | null {
    if (!this.msalInstance) {
      return null;
    }
    return this.msalInstance.getActiveAccount();
  }

  async getGraphClient(): Promise<Client> {
    if (this.graphClient) {
      return this.graphClient;
    }

    try {
      const accessToken = await this.getAccessToken();
      this.graphClient = Client.init({
        authProvider: async (done) => {
          done(null, accessToken);
        },
      });
      return this.graphClient;
    } catch (error) {
      console.error('Error creating Graph client:', error);
      throw error;
    }
  }

  isInitialized(): boolean {
    return this.msalInstance !== null;
  }

  isLoggedIn(): boolean {
    return this.getCurrentAccount() !== null;
  }
}

export const authService = new AuthService();