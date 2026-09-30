export const LOGIN_MUTATION = `
  mutation Login($input: AuthRequest!) {
    login(input: $input) {
      data {
        auth_token
        refresh_token
      }
    }
  }
`;

export const REFRESH_TOKEN_MUTATION = `
  mutation RefreshToken($input: AuthRefreshRequest!) {
    refreshToken(input: $input) {
      data {
        auth_token
        refresh_token
      }
    }
  }
`;

export const ME_QUERY = `
  query Me {
    me {
      current_user {
        data {
          id
          email
        }
      }
    }
  }
`;

export const REDEEM_LOGIN_HANDOFF_MUTATION = `
  mutation RedeemLoginHandoff($input: LoginHandoffRequest!) {
    redeemLoginHandoff(input: $input) {
      data {
        auth_token
        refresh_token
        redirect
      }
    }
  }
`;
