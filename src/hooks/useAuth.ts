import React, { useState, useEffect } from "react";
import { AuthorizedCompany } from "../types";
import { auth, googleProvider } from "../lib/firebaseClient";
import { signInWithPopup, signOut } from "firebase/auth";

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return localStorage.getItem("app_authenticated") === "true";
  });
  const [currentUserEmail, setCurrentUserEmail] = useState<string>(() => {
    return localStorage.getItem("current_user_email") || "";
  });
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState("");

  const [authorizedCompanies, setAuthorizedCompanies] = useState<AuthorizedCompany[]>(() => {
    try {
      const saved = localStorage.getItem("authorized_companies");
      return saved ? JSON.parse(saved) : [
        { id: "comp_1", email: "aga706panambi@gmail.com", nome: "Farmácia Aga706 Panambi", token: "fddfd9871b77f44f243e145207c8e93a", cnpj: "13408443000168" }
      ];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("authorized_companies", JSON.stringify(authorizedCompanies));
  }, [authorizedCompanies]);

  const isAdmin = currentUserEmail === "ckipper22@gmail.com" || currentUserEmail === "aga706panambi@gmail.com" || !currentUserEmail;

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = loginEmail.trim().toLowerCase();
    const password = loginPassword;
    
    if ((cleanEmail === "ckipper22@gmail.com" || cleanEmail === "aga706panambi@gmail.com") && password === "Aq1sw2de#fr4") {
      localStorage.setItem("app_authenticated", "true");
      localStorage.setItem("current_user_email", cleanEmail);
      setCurrentUserEmail(cleanEmail);
      setIsAuthenticated(true);
      setLoginError("");
    } else {
      const foundComp = authorizedCompanies.find(c => c.email.toLowerCase() === cleanEmail);
      if (foundComp) {
        localStorage.setItem("app_authenticated", "true");
        localStorage.setItem("current_user_email", cleanEmail);
        setCurrentUserEmail(cleanEmail);
        setIsAuthenticated(true);
        setLoginError("");
      } else {
        setLoginError("E-mail ou senha incorretos, ou farmácia não cadastrada.");
      }
    }
  };

  const handleGoogleLogin = async () => {
    try {
      setLoginError("");
      const result = await signInWithPopup(auth, googleProvider);
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
            await signOut(auth);
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
      await signOut(auth);
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
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    showPassword,
    setShowPassword,
    loginError,
    setLoginError,
    authorizedCompanies,
    setAuthorizedCompanies,
    isAdmin,
    handleLoginSubmit,
    handleGoogleLogin,
    handleLogout,
  };
}
