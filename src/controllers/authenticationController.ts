/**
 * This controller handles the call from the IDP after a successful
 * authentication. In the request headers there are all the attributes sent from
 * the IDP.
 */

import * as express from "express";
import { isLeft } from "fp-ts/lib/Either";
import {
  IResponseErrorInternal,
  IResponsePermanentRedirect,
  IResponseSuccessXml,
  ResponseErrorInternal,
  ResponsePermanentRedirect,
  ResponseSuccessXml
} from "italia-ts-commons/lib/responses";
import { UrlFromString } from "italia-ts-commons/lib/url";
import { ISessionStorage } from "../services/ISessionStorage";
import TokenService from "../services/tokenService";
import { SessionToken, WalletToken } from "../types/token";
import {
  extractUserFromRequest,
  toAppUser,
  validateSpidUser
} from "../types/user";

export default class AuthenticationController {
  constructor(
    private readonly sessionStorage: ISessionStorage,
    private readonly samlCert: string,
    private readonly spidStrategy: SpidStrategy,
    private readonly tokenService: TokenService,
    private readonly getClientProfileRedirectionUrl: (
      token: string
    ) => UrlFromString
  ) {}

  /**
   * The Assertion consumer service.
   */
  public async acs(
    // tslint:disable-next-line:no-any
    userPayload: any
  ): Promise<IResponseErrorInternal | IResponsePermanentRedirect> {
    const errorOrUser = validateSpidUser(userPayload);

    if (isLeft(errorOrUser)) {
      const error = errorOrUser.value;
      return ResponseErrorInternal(error.message);
    }

    const spidUser = errorOrUser.value;
    const sessionToken = this.tokenService.getNewToken() as SessionToken;
    const walletToken = this.tokenService.getNewToken() as WalletToken;
    const user = toAppUser(spidUser, sessionToken, walletToken);

    const errorOrResponse = await this.sessionStorage.set(user);

    if (isLeft(errorOrResponse)) {
      const error = errorOrResponse.value;
      return ResponseErrorInternal(error.message);
    }
    const response = errorOrResponse.value;

    if (!response) {
      return ResponseErrorInternal("Error creating the user session");
    }
    const urlWithToken = this.getClientProfileRedirectionUrl(
      user.session_token
    );

    return ResponsePermanentRedirect(urlWithToken);
  }

  /**
   * Retrieves the logout url from the IDP.
   */
  public async logout(
    req: express.Request
  ): Promise<IResponseErrorInternal | IResponsePermanentRedirect> {
    const errorOrUser = extractUserFromRequest(req);

    if (isLeft(errorOrUser)) {
      const error = errorOrUser.value;
      return ResponseErrorInternal(error.message);
    }

    const user = errorOrUser.value;

    const errorOrResponse = await this.sessionStorage.del(
      user.session_token,
      user.wallet_token
    );

    if (isLeft(errorOrResponse)) {
      const error = errorOrResponse.value;
      return ResponseErrorInternal(error.message);
    }

    const response = errorOrResponse.value;

    if (!response) {
      return ResponseErrorInternal("Error creating the user session");
    }

    // Logout from SPID.
    // The logout function in spid-passport expects an entityID attribute
    // passed in the query string. Here we recover the IDP chosen for the
    // login (and stored in the User object) to forge a request suitable
    // for the login function.
    req.query = {};
    req.query.entityID = user.spid_idp;

    return this.spidLogout(req);
  }

  /**
   * The Single logout service.
   */
  public async slo(): Promise<IResponsePermanentRedirect> {
    const url: UrlFromString = {
      href: "/"
    };

    return ResponsePermanentRedirect(url);
  }

  /**
   * The metadata for this Service Provider.
   */
  public async metadata(): Promise<IResponseSuccessXml<string>> {
    const metadata = this.spidStrategy.generateServiceProviderMetadata(
      this.samlCert
    );

    return ResponseSuccessXml(metadata);
  }

  /**
   * Wrap the spidStrategy.logout function in a new Promise.
   */
  private spidLogout(
    req: express.Request
  ): Promise<IResponseErrorInternal | IResponsePermanentRedirect> {
    return new Promise(resolve => {
      this.spidStrategy.logout(req, (err, logoutUrl) => {
        if (!err) {
          const url: UrlFromString = {
            href: logoutUrl
          };

          return resolve(ResponsePermanentRedirect(url));
        } else {
          return resolve(ResponseErrorInternal(err.message));
        }
      });
    });
  }
}
