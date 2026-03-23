export const PASSWORD_MIN_LENGTH = 8;

export function buildPasswordLengthMessage(minimum = PASSWORD_MIN_LENGTH) {
  return `Passwords must be at least ${Number(minimum) || PASSWORD_MIN_LENGTH} characters.`;
}

function assertPasswordMinimumLength(password, minimum = PASSWORD_MIN_LENGTH) {
  if (String(password || "").length < minimum) {
    throw new Error(buildPasswordLengthMessage(minimum));
  }
}

export async function openAccountSession({
  username = "",
  password = "",
  signInWithCredentials,
  rebroadcastAccount
} = {}) {
  assertPasswordMinimumLength(password);
  const session = await signInWithCredentials(username, password);
  let warning = "";
  try {
    await rebroadcastAccount(session);
  } catch (error) {
    warning = String(error?.message || error || "Signed in, but the account could not be refreshed on the network yet.");
  }
  return {
    session,
    publicState: null,
    warning
  };
}
