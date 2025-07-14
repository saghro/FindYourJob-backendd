// controllers/authController.js
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { catchAsync, AppError, sendResponse } = require('../utils/helpers');
const { authValidators } = require('../utils/validators');

// Générer un token JWT
const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '15m'
  });
};

// Générer un refresh token
const generateRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d'
  });
};

// Inscription d'un nouvel utilisateur
const register = catchAsync(async (req, res, next) => {
  console.log('Registration attempt with data:', { 
    email: req.body.email, 
    role: req.body.role 
  });

  // Validation des données d'entrée
  const { error } = authValidators.register.validate(req.body);
  if (error) {
    return next(new AppError(error.details[0].message, 400));
  }

  const { firstName, lastName, email, password, role = 'candidate' } = req.body;

  // Vérifier si l'utilisateur existe déjà
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    return next(new AppError('User with this email already exists', 409));
  }

  try {
    // Créer le nouvel utilisateur
    const user = new User({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      password,
      role
    });

    await user.save();
    console.log('User created successfully:', user._id);

    // Générer les tokens
    const tokenPayload = {
      id: user._id,
      email: user.email,
      role: user.role
    };

    const token = generateToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Préparer la réponse utilisateur (sans le mot de passe)
    const userResponse = {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt
    };

    // Envoyer la réponse
    sendResponse(res, 201, 'success', 'User registered successfully', {
      user: userResponse,
      token,
      refreshToken
    });

  } catch (error) {
    console.error('Registration error:', error);
    return next(new AppError('Registration failed. Please try again.', 500));
  }
});

// Connexion d'un utilisateur
const login = catchAsync(async (req, res, next) => {
  console.log('Login attempt for:', req.body.email);

  // Validation des données d'entrée
  const { error } = authValidators.login.validate(req.body);
  if (error) {
    return next(new AppError(error.details[0].message, 400));
  }

  const { email, password } = req.body;

  try {
    // Rechercher l'utilisateur avec le mot de passe
    const user = await User.findOne({ 
      email: email.toLowerCase() 
    }).select('+password');

    if (!user) {
      return next(new AppError('Invalid email or password', 401));
    }

    // Vérifier si l'utilisateur est actif
    if (!user.isActive) {
      return next(new AppError('Account has been deactivated. Please contact support.', 401));
    }

    // Vérifier le mot de passe
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return next(new AppError('Invalid email or password', 401));
    }

    // Mettre à jour la dernière connexion
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    console.log('Login successful for user:', user._id);

    // Générer les tokens
    const tokenPayload = {
      id: user._id,
      email: user.email,
      role: user.role
    };

    const token = generateToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Préparer la réponse utilisateur (sans le mot de passe)
    const userResponse = {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      profile: user.profile || {},
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt
    };

    // Envoyer la réponse
    sendResponse(res, 200, 'success', 'Login successful', {
      user: userResponse,
      token,
      refreshToken
    });

  } catch (error) {
    console.error('Login error:', error);
    return next(new AppError('Login failed. Please try again.', 500));
  }
});

// Déconnexion d'un utilisateur
const logout = catchAsync(async (req, res, next) => {
  console.log('Logout for user:', req.user?.id);

  sendResponse(res, 200, 'success', 'Logout successful');
});

// Obtenir le profil de l'utilisateur connecté
const getMe = catchAsync(async (req, res, next) => {
  console.log('Getting profile for user:', req.user.id);

  try {
    // L'utilisateur est déjà attaché à req.user par le middleware auth
    const user = await User.findById(req.user.id)
      .populate('savedJobs', 'title location type salary company')
      .populate({
        path: 'savedJobs',
        populate: {
          path: 'company',
          select: 'name logo'
        }
      });

    if (!user) {
      return next(new AppError('User not found', 404));
    }

    // Préparer la réponse
    const userResponse = {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      profile: user.profile || {},
      savedJobs: user.savedJobs || [],
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    sendResponse(res, 200, 'success', 'Profile retrieved successfully', {
      user: userResponse
    });

  } catch (error) {
    console.error('Get profile error:', error);
    return next(new AppError('Failed to retrieve profile', 500));
  }
});

// Rafraîchir le token
const refreshToken = catchAsync(async (req, res, next) => {
  const { refreshToken: clientRefreshToken } = req.body;

  if (!clientRefreshToken) {
    return next(new AppError('Refresh token is required', 400));
  }

  try {
    // Vérifier le refresh token
    const decoded = jwt.verify(clientRefreshToken, process.env.JWT_REFRESH_SECRET);

    // Rechercher l'utilisateur
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return next(new AppError('Invalid refresh token', 401));
    }

    // Générer de nouveaux tokens
    const tokenPayload = {
      id: user._id,
      email: user.email,
      role: user.role
    };

    const newToken = generateToken(tokenPayload);
    const newRefreshToken = generateRefreshToken(tokenPayload);

    sendResponse(res, 200, 'success', 'Token refreshed successfully', {
      token: newToken,
      refreshToken: newRefreshToken
    });

  } catch (error) {
    console.error('Refresh token error:', error);
    return next(new AppError('Invalid or expired refresh token', 401));
  }
});

// Demande de réinitialisation de mot de passe
const forgotPassword = catchAsync(async (req, res, next) => {
  const { error } = authValidators.forgotPassword.validate(req.body);
  if (error) {
    return next(new AppError(error.details[0].message, 400));
  }

  const { email } = req.body;

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      // Pour la sécurité, on renvoie toujours la même réponse
      return sendResponse(res, 200, 'success', 
        'If an account with that email exists, a password reset link has been sent');
    }

    // Générer un token de réinitialisation
    const resetToken = jwt.sign(
      { id: user._id, purpose: 'password-reset' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Sauvegarder le token dans la base (hashé)
    const crypto = require('crypto');
    user.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.passwordResetExpires = Date.now() + 60 * 60 * 1000; // 1 heure
    await user.save({ validateBeforeSave: false });

    console.log('Password reset requested for:', email);
    console.log('Reset token (dev only):', resetToken);

    sendResponse(res, 200, 'success', 
      'If an account with that email exists, a password reset link has been sent');

  } catch (error) {
    console.error('Forgot password error:', error);
    return next(new AppError('Failed to process password reset request', 500));
  }
});

// Réinitialisation de mot de passe
const resetPassword = catchAsync(async (req, res, next) => {
  const { error } = authValidators.resetPassword.validate(req.body);
  if (error) {
    return next(new AppError(error.details[0].message, 400));
  }

  const { token, password } = req.body;

  try {
    // Vérifier le token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.purpose !== 'password-reset') {
      return next(new AppError('Invalid reset token', 400));
    }

    // Hasher le token pour comparer avec la base
    const crypto = require('crypto');
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // Rechercher l'utilisateur avec le token valide
    const user = await User.findOne({
      _id: decoded.id,
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) {
      return next(new AppError('Invalid or expired reset token', 400));
    }

    // Mettre à jour le mot de passe
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    console.log('Password reset successful for user:', user._id);

    // Générer de nouveaux tokens
    const tokenPayload = {
      id: user._id,
      email: user.email,
      role: user.role
    };

    const newToken = generateToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Préparer la réponse utilisateur
    const userResponse = {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      emailVerified: user.emailVerified
    };

    sendResponse(res, 200, 'success', 'Password reset successful', {
      user: userResponse,
      token: newToken,
      refreshToken
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return next(new AppError('Invalid or expired reset token', 400));
    }
    
    console.error('Reset password error:', error);
    return next(new AppError('Failed to reset password', 500));
  }
});

// Vérification d'email
const verifyEmail = catchAsync(async (req, res, next) => {
  const { token } = req.params;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.purpose !== 'email-verification') {
      return next(new AppError('Invalid verification token', 400));
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return next(new AppError('Invalid verification token', 400));
    }

    if (user.emailVerified) {
      return sendResponse(res, 200, 'success', 'Email already verified');
    }

    user.emailVerified = true;
    await user.save({ validateBeforeSave: false });

    console.log('Email verified for user:', user._id);

    sendResponse(res, 200, 'success', 'Email verified successfully');

  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return next(new AppError('Invalid or expired verification token', 400));
    }
    
    console.error('Email verification error:', error);
    return next(new AppError('Failed to verify email', 500));
  }
});

module.exports = {
  register,
  login,
  logout,
  getMe,
  refreshToken,
  forgotPassword,
  resetPassword,
  verifyEmail
};