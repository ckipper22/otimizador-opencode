import React, { useState, useEffect } from "react";
import { AuthorizedCompany } from "../types";
import { getFirebaseAuth } from "../lib/firebaseClient";
import { signInWithPopup, signOut } from "firebase/auth";

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return localStorage.getItem("app_authenticated") === "true";
  });
  const [currentUserEmail, setCurrentUserEmail] = useState<string>(() => {
    return localStorage.getItem("current_user_email") || "";
  });
  const [loginError, setLoginError] = useState("");

  const [authorizedCompanies, setAuthorizedCompanies] = useState<AuthorizedCompany[]>(() => {
    try {
      const saved = localStorage.getItem("authorized_companies");
      return saved ? JSON.parse(saved) : [
        { id: "comp_1", email: "aga706panambi@gmail.com", nome: "Farmácia Aga706 Panambi", token: "", cnpj: "13408443000168" }
      ];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("authorized_companies", JSON.stringify(authorizedCompanies));
  }, [authorizedCompanies]);

  const isAdmin = currentUserEmail === "ckipper22@gmail.com" || currentUserEmail === "aga706panambi@gmail.com" || !currentUserEmail;

  const handleGoogleLogin = async () => {
    try {
      setLoginError("");
      const { auth: fbAuth, googleProvider: fbProvider } = await getFirebaseAuth();
      const result = await signInWithPopup(fbAuth, fbProvider);
      const user = result.user;
      const verifiedEmail = user.email?.toLowerCase();

      if (verifiedEmail) {
        if (verifiedEmail === "ckipper22@gmail.com" || verifiedEmail === "aga706panambi@gmail.com") {
          localStorage.setItem("app_authenticated", "true");
          localStorage.setItem("current_user_email", verifiedEmail);
          setCurrentUserEmail(verifiedEmail);
          setIsAuthenticated(true);
          setLoginError("");
          return;
        } else {
          const foundComp = authorizedCompanies.find(c => c.email.toLowerCase() === verifiedEmail);
          if (foundComp) {
            localStorage.setItem("app_authenticated", "true");
            localStorage.setItem("current_user_email", verifiedEmail);
            setCurrentUserEmail(verifiedEmail);
            setIsAuthenticated(true);
            setLoginError("");
            return;
          } else {
            await signOut(fbAuth);
            setLoginError(`Acesso negado. A conta Google autenticada ("${verifiedEmail}") não está cadastrada. Solicite ao administrador (ckipper22@gmail.com) o cadastro.`);
          }
        }
      } else {
        setLoginError("Não foi possível obter o e-mail da conta Google autenticada.");
      }
    } catch (error: any) {
      console.error("Google login error:", error);
      if (error.code === 'auth/popup-closed-by-user') {
        setLoginError("Autenticação Google cancelada pelo usuário.");
      } else {
        setLoginError(`Erro na autenticação Google: ${error.message || error}`);
      }
    }
  };

  const handleLogout = async () => {
    try {
      const { auth: fbAuth } = await getFirebaseAuth();
      await signOut(fbAuth);
    } catch (e) {
      // ignore
    }
    localStorage.removeItem("app_authenticated");
    localStorage.removeItem("current_user_email");
    setIsAuthenticated(false);
    setCurrentUserEmail("");
  };

  return {
    isAuthenticated,
    currentUserEmail,
    loginError,
    setLoginError,
    authorizedCompanies,
    setAuthorizedCompanies,
    isAdmin,
    handleGoogleLogin,
    handleLogout,
  };
}
