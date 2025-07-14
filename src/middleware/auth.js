// middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { AppError, catchAsync } = require('../utils/helpers');

// Middleware d'authentification
const auth = catchAsync(async (req, res, next) => {
  // 1. Récupérer le token depuis les headers
  let token;
  
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new AppError('Access token is required. Please log in.', 401));
  }

  try {
    // 2. Vérifier le token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 3. Vérifier si l'utilisateur existe toujours
    const currentUser = await User.findById(decoded.id).select('+isActive');
    
    if (!currentUser) {
      return next(new AppError('The user belonging to this token no longer exists.', 401));
    }

    // 4. Vérifier si l'utilisateur est actif
    if (!currentUser.isActive) {
      return next(new AppError('Your account has been deactivated. Please contact support.', 401));
    }

    // 5. Attacher l'utilisateur à la requête
    req.user = currentUser;
    
    next();
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return next(new AppError('Invalid token. Please log in again.', 401));
    } else if (error.name === 'TokenExpiredError') {
      return next(new AppError('Your token has expired. Please log in again.', 401));
    }
    
    console.error('Auth middleware error:', error);
    return next(new AppError('Authentication failed. Please log in again.', 401));
  }
});

// Middleware d'autorisation par rôle
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required.', 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to perform this action.', 403));
    }

    next();
  };
};

// Middleware optionnel d'authentification (n'échoue pas si pas de token)
const optionalAuth = catchAsync(async (req, res, next) => {
  let token;
  
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    // Pas de token, continuer sans utilisateur authentifié
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const currentUser = await User.findById(decoded.id).select('+isActive');
    
    if (currentUser && currentUser.isActive) {
      req.user = currentUser;
    }
    
    next();
    
  } catch (error) {
    // En cas d'erreur, continuer sans utilisateur authentifié
    console.warn('Optional auth failed:', error.message);
    next();
  }
});

// Middleware pour vérifier si l'utilisateur possède une ressource
const checkOwnership = (model, paramName = 'id', userField = 'user') => {
  return catchAsync(async (req, res, next) => {
    const resourceId = req.params[paramName];
    
    if (!resourceId) {
      return next(new AppError('Resource ID is required.', 400));
    }

    const Model = require(`../models/${model}`);
    const resource = await Model.findById(resourceId);
    
    if (!resource) {
      return next(new AppError(`${model} not found.`, 404));
    }

    // Vérifier la propriété
    const resourceUserId = resource[userField];
    const currentUserId = req.user._id;
    
    if (resourceUserId.toString() !== currentUserId.toString() && req.user.role !== 'admin') {
      return next(new AppError('You can only access your own resources.', 403));
    }

    // Attacher la ressource à la requête pour éviter une nouvelle requête
    req.resource = resource;
    
    next();
  });
};

// Middleware pour limiter les tentatives de connexion
const loginLimiter = (req, res, next) => {
  // Implémentation simple basée sur l'IP
  // En production, utiliser Redis pour un stockage distribué
  
  const maxAttempts = 5;
  const windowMs = 15 * 60 * 1000; // 15 minutes
  
  const clientIp = req.ip || req.connection.remoteAddress;
  const key = `login_attempts_${clientIp}`;
  
  // Simuler un stockage en mémoire (en production, utiliser Redis)
  if (!global.loginAttempts) {
    global.loginAttempts = new Map();
  }
  
  const attempts = global.loginAttempts.get(key);
  const now = Date.now();
  
  if (attempts && attempts.count >= maxAttempts) {
    if (now - attempts.firstAttempt < windowMs) {
      const remainingTime = Math.ceil((windowMs - (now - attempts.firstAttempt)) / 60000);
      return next(new AppError(
        `Too many login attempts. Please try again in ${remainingTime} minutes.`, 
        429
      ));
    } else {
      // Réinitialiser après la fenêtre de temps
      global.loginAttempts.delete(key);
    }
  }
  
  next();
};

// Middleware pour enregistrer une tentative de connexion échouée
const recordFailedLogin = (req, res, next) => {
  // Ce middleware sera appelé en cas d'échec de connexion
  const clientIp = req.ip || req.connection.remoteAddress;
  const key = `login_attempts_${clientIp}`;
  
  if (!global.loginAttempts) {
    global.loginAttempts = new Map();
  }
  
  const attempts = global.loginAttempts.get(key);
  const now = Date.now();
  
  if (!attempts) {
    global.loginAttempts.set(key, {
      count: 1,
      firstAttempt: now,
      lastAttempt: now
    });
  } else {
    attempts.count += 1;
    attempts.lastAttempt = now;
    global.loginAttempts.set(key, attempts);
  }
  
  next();
};

// Middleware pour réinitialiser les tentatives après succès
const resetLoginAttempts = (req, res, next) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  const key = `login_attempts_${clientIp}`;
  
  if (global.loginAttempts) {
    global.loginAttempts.delete(key);
  }
  
  next();
};

// Middleware pour vérifier les permissions spécifiques
const checkPermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required.', 401));
    }

    // Système de permissions basé sur les rôles
    const permissions = {
      admin: ['*'], // Toutes les permissions
      employer: [
        'job.create',
        'job.update',
        'job.delete',
        'application.view',
        'application.update',
        'company.create',
        'company.update'
      ],
      candidate: [
        'application.create',
        'application.view_own',
        'job.view',
        'profile.update'
      ]
    };

    const userPermissions = permissions[req.user.role] || [];
    
    // Les admins ont tous les droits
    if (userPermissions.includes('*')) {
      return next();
    }

    // Vérifier la permission spécifique
    if (!userPermissions.includes(permission)) {
      return next(new AppError('Insufficient permissions.', 403));
    }

    next();
  };
};

// Middleware pour valider les paramètres utilisateur
const validateUserParams = (req, res, next) => {
  const { id } = req.params;
  
  if (id && !id.match(/^[0-9a-fA-F]{24}$/)) {
    return next(new AppError('Invalid user ID format.', 400));
  }
  
  next();
};

// Middleware pour vérifier la vérification email
const requireEmailVerification = (req, res, next) => {
  if (!req.user.emailVerified) {
    return next(new AppError('Please verify your email address before proceeding.', 403));
  }
  
  next();
};

// Middleware pour logs d'audit
const auditLog = (action) => {
  return (req, res, next) => {
    // Log des actions importantes pour audit
    const logData = {
      timestamp: new Date().toISOString(),
      action,
      userId: req.user?._id,
      userRole: req.user?.role,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      resourceId: req.params.id,
      method: req.method,
      path: req.path
    };
    
    // En production, envoyer vers un service de logging
    console.log('AUDIT:', JSON.stringify(logData));
    
    next();
  };
};

module.exports = {
  auth,
  authorize,
  optionalAuth,
  checkOwnership,
  loginLimiter,
  recordFailedLogin,
  resetLoginAttempts,
  checkPermission,
  validateUserParams,
  requireEmailVerification,
  auditLog
};